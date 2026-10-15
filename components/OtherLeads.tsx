'use client'

// The customer's other active leads. Since the new lead intake one contact can
// have several leads open at once (Duplicate Check, UQL, MQL, Long Term,
// Eneco), and a rep only sees the one they were assigned: they booked the
// wrong product, or moved a lead to Lost while the customer still wanted
// another one. Two places use this:
//   - OtherLeadsSection: a block in the lead modal listing those leads, with
//     Claim (assign to me + move to MQL) to work on one of them instead.
//   - OtherLeadsModal: after a lead is booked, Lost or Long Term, a popup asks
//     what to do with the rest, one call result per lead.
// Decisions (Andreas, 2026-10-15): the popup offers only Lost, Long Term and
// Send Configurator Link (after testing with the team; booking another lead
// is done by claiming it); Lost needs a reason per lead; Long Term gets a date
// and reason but no task; colleagues' leads can be claimed (after a confirm)
// and are in the popup; Eneco leads are shown only.

import { Fragment, useEffect, useRef, useState } from 'react'
import { useApp } from '@/context/AppContext'
import { translate, translateArr } from '@/lib/i18n'
import { CONFIG, LTO_REASON_MIN } from '@/lib/config'
import { fetchContactActiveLeads, fetchLeadPropertyOptions, fetchOwnerName, onLeadWrite, patchLead } from '@/lib/hubspot'
import type { AppState, Lang, Lead, OtherLead, ProcessedOutcome } from '@/lib/types'
import { showToast } from './Toast'

type Opt = { label: string; value: string }
type T = (k: string, ...a: any[]) => string

/**
 * The call results the popup offers, in this order, besides "Leave open"
 * (Andreas and the team, 2026-10-15). Labels come from HubSpot.
 */
const POPUP_RESULTS = ['Lost', 'Long Term Opportunity', 'Send Configurator Link']
/** Prefilled as the Lost reason when the processed lead was booked. */
const DUPLICATE_REASON = 'Ordered via other channel / Duplicate'

function olDate(iso: string, withTime = false): string {
  if (!iso) return '--'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const sameYear = d.getFullYear() === new Date().getFullYear()
  const day = d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })
  return withTime ? `${day} ${d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}` : day
}

// Product values ("All-E Duo") have friendlier labels ("All-E Full System Duo").
// Read once per page load; not cached when empty, so a failed read retries.
let _productLabels: Promise<Record<string, string>> | null = null
function productLabels(): Promise<Record<string, string>> {
  if (!_productLabels) {
    _productLabels = fetchLeadPropertyOptions('selected_product_lead_all_time').then(opts => {
      if (!opts.length) _productLabels = null
      return Object.fromEntries(opts.map(o => [o.value, o.label]))
    })
  }
  return _productLabels
}

function showProduct(raw: string, labels: Record<string, string>): string {
  return raw.split(';').map(v => v.trim()).filter(Boolean).map(v => labels[v] || v).join(', ') || '--'
}

function useOwnerNames(ownerIds: string[]): Record<string, string> {
  const [names, setNames] = useState<Record<string, string>>({})
  const key = Array.from(new Set(ownerIds.filter(Boolean))).sort().join(',')
  useEffect(() => {
    let stale = false
    const ids = key ? key.split(',') : []
    Promise.all(ids.map(id => fetchOwnerName(id).then(n => [id, n] as const)))
      .then(pairs => { if (!stale) setNames(Object.fromEntries(pairs)) })
    return () => { stale = true }
  }, [key])
  return names
}

function ownerText(ownerId: string, myId: string, names: Record<string, string>, t: T): string {
  if (!ownerId) return t('olUnassigned')
  if (ownerId === myId) return t('olYou')
  return names[ownerId] || `#${ownerId}`
}

function StageChip({ label }: { label: string }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99, whiteSpace: 'nowrap', flexShrink: 0,
      border: '1px solid var(--cb)', background: 'var(--c2)', color: 'var(--ct)',
    }}>{label}</span>
  )
}

function leadUrl(portalId: string | null, leadId: string): string {
  return portalId ? `https://app-eu1.hubspot.com/contacts/${portalId}/record/0-136/${leadId}` : ''
}

// ── Block in the lead modal ──────────────────────────────────────────────────

/**
 * "Customer's other leads (N)", under Recent activity. Loaded when the lead
 * opens, collapsed by default like Recent activity; the count turns orange
 * when there is something to look at.
 */
export function OtherLeadsSection({ contactId, leadId, lang }: { contactId: string; leadId: string; lang: Lang }) {
  const { state, setState } = useApp()
  const t: T = (k, ...a) => translate(lang, k, ...a)
  const myId = state.currentRep?.hubspotOwnerId || ''

  // Tagged with the lead it was loaded for, so a switch never shows the
  // previous lead's list.
  const [data, setData] = useState<{ leadId: string; leads: OtherLead[] | null } | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [labels, setLabels] = useState<Record<string, string>>({})
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let stale = false
    fetchContactActiveLeads(contactId, leadId)
      .then(leads => { if (!stale) setData({ leadId, leads }) })
      .catch(e => {
        console.error('[hs] other leads failed:', leadId, e)
        if (!stale) setData({ leadId, leads: null })
      })
    return () => { stale = true }
  }, [contactId, leadId, reload])

  // Reload when one of these leads is written (claimed elsewhere, or changed
  // in the popup while this modal stays open, e.g. after Plan HV).
  const shown = data && data.leadId === leadId ? data.leads : undefined
  const shownIds = useRef<string[]>([])
  shownIds.current = (shown || []).map(o => o.id)
  useEffect(() => onLeadWrite(id => { if (shownIds.current.includes(id)) setReload(n => n + 1) }), [])

  useEffect(() => { if (open) productLabels().then(setLabels) }, [open])
  const owners = useOwnerNames((shown || []).map(o => o.ownerId))

  async function claim(o: OtherLead) {
    if (!myId) return
    if (o.ownerId && o.ownerId !== myId && !window.confirm(t('olTakeOver', ownerText(o.ownerId, myId, owners, t)))) return
    // Moved to MQL so it lands on the board like any assigned lead, and counts
    // as processed in Team performance (which counts leads leaving MQL).
    const props: Record<string, string> = { hubspot_owner_id: myId }
    if (o.stageId !== CONFIG.STAGES.MQL) props.hs_pipeline_stage = CONFIG.STAGES.MQL
    setBusy(o.id)
    try {
      await patchLead(o.id, props, state.leads, leads => setState({ leads }))
      const claimed: Lead = { id: o.id, properties: { ...o.lead.properties, ...props } }
      setState(prev => ({
        leads: prev.leads.some(l => l.id === o.id)
          ? prev.leads.map(l => l.id === o.id ? claimed : l)
          : [claimed, ...prev.leads],
        selectedId: o.id,
      }))
      showToast(t('olClaimed', o.name), 'success')
    } catch (e: unknown) {
      showToast(t('olClaimFailed', e instanceof Error ? e.message : String(e)), 'error', 6000)
    } finally {
      setBusy(null)
    }
  }

  function openLead(o: OtherLead) {
    setState(prev => ({
      leads: prev.leads.some(l => l.id === o.id) ? prev.leads : [o.lead, ...prev.leads],
      selectedId: o.id,
    }))
  }

  const count = shown ? shown.length : 0
  return (
    <div>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setOpen(o => !o)}
      >
        <div className="sl2">{t('olTitle')}</div>
        <span style={{ fontSize: 11, color: count > 0 ? 'var(--or)' : 'var(--cs)', fontWeight: count > 0 ? 700 : 400 }}>
          {shown === undefined ? '…' : shown === null ? '(!)' : `(${count})`}
        </span>
        <span style={{ fontSize: 11, color: 'var(--cs)' }}>{open ? '▾' : '▸'}</span>
      </div>

      {open && shown === null && (
        <div style={{ fontSize: 12, color: 'var(--cs)', padding: '6px 0' }}>{t('olFailed')}</div>
      )}
      {open && shown && shown.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--cs)', padding: '6px 0' }}>{t('olNone')}</div>
      )}
      {open && shown && shown.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          {shown.map(o => {
            const mineInMql = o.ownerId === myId && o.stageId === CONFIG.STAGES.MQL
            const url = leadUrl(state.hubspotPortalId, o.id)
            return (
              <div key={o.id} style={{ border: '1px solid var(--cb)', borderRadius: 6, padding: '8px 10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <div
                    style={{ fontSize: 12, fontWeight: 700, color: 'var(--ct)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={o.name}
                  >{o.name}</div>
                  <StageChip label={o.stage} />
                </div>
                {/* A grid, so every value lines up after the longest label
                    ("Self Service Quote accepted") instead of each row
                    pushing its own value along. */}
                <div style={{ display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', columnGap: 10, rowGap: 3, marginTop: 6, fontSize: 12 }}>
                  {([
                    [t('olCreated'), olDate(o.createdAt, true)],
                    [t('olProduct'), showProduct(o.product, labels)],
                    [t('olOrigin'), o.origin || '--'],
                    [t('olSsq'), olDate(o.ssqAcceptedAt)],
                    [t('olOwner'), ownerText(o.ownerId, myId, owners, t)],
                  ] as Array<[string, string]>).map(([label, value]) => (
                    <Fragment key={label}>
                      <span className="kk">{label}</span>
                      <span className="vv">{value}</span>
                    </Fragment>
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  {o.readOnly ? (
                    <span style={{ fontSize: 11, color: 'var(--cs)' }}>{t('olEnecoNote')}</span>
                  ) : mineInMql ? (
                    <button className="btn btn-sc btn-xs" onClick={() => openLead(o)}>{t('olOpen')}</button>
                  ) : (
                    <button className="btn btn-pr btn-xs" disabled={busy !== null || !myId} onClick={() => claim(o)}>
                      {busy === o.id ? '…' : t('olClaim')}
                    </button>
                  )}
                  {url && (
                    <a className="btn btn-sc btn-xs" href={url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                      {t('olHubspot')}
                    </a>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── After a lead is processed ────────────────────────────────────────────────

/**
 * Called once a lead is booked (Plan HV / Plan Call), Lost or Long Term. Looks
 * up the customer's other active leads and, if there are any the rep may
 * change (not Eneco), opens the "rest of the leads" popup. Runs in the
 * background: the lead's own flow never waits for it.
 */
export async function promptOtherLeads(
  lead: Lead,
  outcome: ProcessedOutcome,
  setState: (partial: Partial<AppState>) => void,
  lang: Lang,
  lto?: { date: string; reason: string },
): Promise<void> {
  const contactId = String(lead.properties?.hs_primary_contact_id || '')
  if (!contactId) return
  try {
    const leads = (await fetchContactActiveLeads(contactId, lead.id)).filter(o => !o.readOnly)
    if (!leads.length) return
    setState({
      otherLeadsPrompt: {
        processedId: lead.id,
        processedName: lead.properties?.hs_lead_name || '',
        outcome,
        ltoDate: lto?.date,
        ltoReason: lto?.reason,
        leads,
      },
    })
  } catch (e) {
    console.error('[hs] other leads check failed:', lead.id, e)
    showToast(translate(lang, 'orlCheckFailed'), 'error', 9000)
  }
}

interface Choice { result: string; lostReason: string; ltoDate: string; ltoReason: string }

// Local date parts, not toISOString(): that converts to UTC and can land on
// the previous day for anyone east of Greenwich.
function ymd(d: Date): string {
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function plusMonths(n: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() + n)
  return ymd(d)
}

/** The properties a choice writes. Lost and Long Term move the stage, like their buttons do. */
function propsFor(c: Choice): Record<string, string> {
  const P = CONFIG.PROPS
  if (c.result === 'Lost') {
    return { hs_pipeline_stage: CONFIG.STAGES.LOST, [P.lostReasons]: c.lostReason, [P.callResult]: 'Lost' }
  }
  if (c.result === 'Long Term Opportunity') {
    return {
      hs_pipeline_stage: CONFIG.STAGES.LTO,
      [P.callResult]: 'Long Term Opportunity',
      long_term_opportunity_followup_date_lead: c.ltoDate,
      long_term_opportunity_reason_lead: c.ltoReason.trim(),
    }
  }
  // Send Configurator Link: only the call result; HubSpot's workflows take it from there.
  return { [P.callResult]: c.result }
}

/** Why a choice can't be saved yet, or null. */
function problemWith(c: Choice, t: T): string | null {
  if (c.result === 'Lost' && !c.lostReason) return t('orlNeedLostReason')
  if (c.result === 'Long Term Opportunity') {
    if (!c.ltoDate) return t('ltoNeedDate')
    if (c.ltoDate < ymd(new Date())) return t('ltoDatePast')
    if (c.ltoReason.trim().length < LTO_REASON_MIN) return t('ltoReasonShort', LTO_REASON_MIN)
  }
  return null
}

/**
 * "What do you want to do with the rest of the leads?" Every lead starts on
 * "Leave open", and closing or saving without changes writes nothing.
 * Rendered by AppShell, above the lead modal and the deal banner, because
 * the lead modal has usually closed by now (Lost, Long Term).
 */
export default function OtherLeadsModal() {
  const { state, setState } = useApp()
  const prompt = state.otherLeadsPrompt
  const lang = state.lang
  const t: T = (k, ...a) => translate(lang, k, ...a)
  const myId = state.currentRep?.hubspotOwnerId || ''
  const booked = prompt?.outcome === 'Plan HV' || prompt?.outcome === 'Plan Call'

  const [resultOpts, setResultOpts] = useState<Opt[]>([])
  const [lostOpts, setLostOpts] = useState<Opt[]>([])
  const [labels, setLabels] = useState<Record<string, string>>({})
  const [choices, setChoices] = useState<Record<string, Choice>>(() => Object.fromEntries(
    (prompt?.leads || []).map(o => [o.id, {
      result: '',
      lostReason: '',
      // Copied from the processed lead when it went Long Term
      ltoDate: prompt?.ltoDate || plusMonths(1),
      ltoReason: prompt?.ltoReason || '',
    }]),
  ))
  const [saved, setSaved] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [checked, setChecked] = useState(false)
  const [saving, setSaving] = useState(false)
  const owners = useOwnerNames((prompt?.leads || []).map(o => o.ownerId))

  useEffect(() => {
    fetchLeadPropertyOptions(CONFIG.PROPS.callResult).then(opts => setResultOpts(
      POPUP_RESULTS.map(v => opts.find(o => o.value === v) || { label: v, value: v })))
    fetchLeadPropertyOptions(CONFIG.PROPS.lostReasons).then(all => {
      // Long Term has its own result, so it's not offered as a Lost reason (as in the Lost popup)
      const opts = all.filter(o => o.label.trim().toLowerCase() !== 'long term opportunity')
      setLostOpts(opts.length ? opts : translateArr(lang, 'lostReasons').map(o => ({ label: o, value: o })))
    })
    productLabels().then(setLabels)
  }, [lang])

  if (!prompt) return null

  function close() { setState({ otherLeadsPrompt: null }) }

  function update(id: string, patch: Partial<Choice>) {
    setChoices(prev => {
      const next = { ...prev[id], ...patch }
      // Booked customer: the other leads are usually duplicates
      if (patch.result === 'Lost' && !next.lostReason && booked) {
        const dup = lostOpts.find(o => o.value === DUPLICATE_REASON) || lostOpts.find(o => /duplicate/i.test(o.value))
        if (dup) next.lostReason = dup.value
      }
      return { ...prev, [id]: next }
    })
    setErrors(prev => { const e = { ...prev }; delete e[id]; return e })
  }

  async function save() {
    if (!prompt) return
    const todo = prompt.leads.filter(o => !saved[o.id] && choices[o.id]?.result)
    if (!todo.length) { close(); return }
    setChecked(true)
    if (todo.some(o => problemWith(choices[o.id], t))) return

    setSaving(true)
    const results = await Promise.allSettled(todo.map(o =>
      patchLead(o.id, propsFor(choices[o.id]), state.leads, () => {}).then(() => o)))
    const ok: OtherLead[] = []
    const failed: Record<string, string> = {}
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') ok.push(r.value)
      else failed[todo[i].id] = r.reason instanceof Error ? r.reason.message : String(r.reason)
    })
    setSaved(prev => ({ ...prev, ...Object.fromEntries(ok.map(o => [o.id, true])) }))
    setErrors(failed)

    // Keep the board in step: Lost / Long Term leave it, the rest just change.
    if (ok.length) {
      const gone = new Set(ok.filter(o => ['Lost', 'Long Term Opportunity'].includes(choices[o.id].result)).map(o => o.id))
      const changed = new Map(ok.map(o => [o.id, propsFor(choices[o.id])]))
      setState(prev => ({
        leads: prev.leads
          .filter(l => !gone.has(l.id))
          .map(l => changed.has(l.id) ? { ...l, properties: { ...l.properties, ...changed.get(l.id) } } : l),
      }))
    }
    setSaving(false)

    if (Object.keys(failed).length) {
      showToast(t('orlSomeFailed'), 'error', 9000)
    } else {
      showToast(t('orlSavedAll', ok.length), 'success')
      close()
    }
  }

  const outcomeLabel = resultOpts.find(o => o.value === prompt.outcome)?.label || prompt.outcome

  return (
    <div className="mb" style={{ zIndex: 10000 }}>
      <div className="mo" style={{ maxWidth: 640 }}>
        <div className="moh">
          <div>
            <div className="mot">{t('orlTitle')}</div>
            <div style={{ fontSize: 12, color: 'var(--cs)', marginTop: 4 }}>
              {t('orlProcessed', prompt.processedName || '--', outcomeLabel)} {t('orlIntro')}
            </div>
          </div>
          <button className="xb" onClick={close} disabled={saving} style={{ flexShrink: 0, marginLeft: 10 }}>✕</button>
        </div>
        <div className="mob">
          {prompt.leads.map(o => {
            const c = choices[o.id]
            const done = !!saved[o.id]
            const problem = checked && !done && c.result ? problemWith(c, t) : null
            return (
              <div key={o.id} style={{ border: '1px solid var(--cb)', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <div
                    style={{ fontSize: 13, fontWeight: 700, color: 'var(--ct)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={o.name}
                  >{o.name}</div>
                  <StageChip label={o.stage} />
                </div>
                <div style={{ fontSize: 11, color: 'var(--cs)', marginTop: 3 }}>
                  {t('olCreated')} {olDate(o.createdAt, true)} · {showProduct(o.product, labels)} · {t('olOwner')}: {ownerText(o.ownerId, myId, owners, t)}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                  <select
                    className="sel"
                    aria-label={t('orlResult')}
                    value={c.result}
                    disabled={done || saving}
                    onChange={e => update(o.id, { result: e.target.value })}
                  >
                    <option value="">{t('orlLeaveOpen')}</option>
                    {resultOpts.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>

                  {c.result === 'Lost' && (
                    <div>
                      <label className="il">{t('lostReason')} <span style={{ color: 'var(--rd)' }}>*</span></label>
                      <select className="sel" value={c.lostReason} disabled={done || saving}
                        onChange={e => update(o.id, { lostReason: e.target.value })}>
                        <option value="">--</option>
                        {lostOpts.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                    </div>
                  )}

                  {c.result === 'Long Term Opportunity' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div>
                        <label className="il">{t('ltoWhen')} <span style={{ color: 'var(--rd)' }}>*</span></label>
                        <input className="inp" type="date" min={ymd(new Date())} value={c.ltoDate} disabled={done || saving}
                          onChange={e => update(o.id, { ltoDate: e.target.value })} />
                      </div>
                      <div>
                        <label className="il">{t('ltoReason')} <span style={{ color: 'var(--rd)' }}>*</span></label>
                        <textarea className="inp" rows={2} placeholder={t('ltoReasonPh')} value={c.ltoReason} disabled={done || saving}
                          onChange={e => update(o.id, { ltoReason: e.target.value })} />
                        <div style={{ fontSize: 11, color: c.ltoReason.trim().length < LTO_REASON_MIN ? 'var(--or)' : 'var(--cs)', marginTop: 2 }}>
                          {t('ltoReasonCount', c.ltoReason.trim().length, LTO_REASON_MIN)}
                        </div>
                      </div>
                    </div>
                  )}

                  {problem && <div style={{ fontSize: 11, color: 'var(--rd)' }}>{problem}</div>}
                  {errors[o.id] && <div style={{ fontSize: 11, color: 'var(--rd)' }}>{t('orlFailed', errors[o.id])}</div>}
                  {done && <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gr)' }}>✓ {t('orlSaved')}</div>}
                </div>
              </div>
            )
          })}
        </div>
        <div className="mof">
          <button className="btn btn-sc btn-sm" onClick={close} disabled={saving}>{t('close')}</button>
          <button className="btn btn-pr btn-sm" onClick={save} disabled={saving}>
            {saving ? t('orlSaving') : t('orlSave')}
          </button>
        </div>
      </div>
    </div>
  )
}
