'use client'

import { Fragment, useRef, useCallback, useState, useEffect } from 'react'
import { useApp } from '@/context/AppContext'
import { translate, translateArr } from '@/lib/i18n'
import { CONFIG } from '@/lib/config'
import { patchLead as patchLeadApi, fetchLeadPropertyOptions, fetchAssociatedDeal, fetchLeadContact, buildSchedulerUrl, fetchContactActivity, ACTIVITY_CAP } from '@/lib/hubspot'
import type { Activity, ActivityKind, ActivityGroups } from '@/lib/hubspot'
import { getPlaybookDefs } from '@/lib/playbooks'
import { dealOpenTasks } from '@/lib/storage'
import { showToast } from './Toast'
import PlaybookView from './PlaybookView'
import type { Deal, Scheduler } from '@/lib/types'

function initials(name: string) {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

function getScheduler(deal: Deal, scheds: Scheduler[]): Scheduler | null {
  if (!scheds.length) return null
  const prod = (deal?.properties?.[CONFIG.PROPS.product] || '').toLowerCase()
  // Match against productMatches array (new) or legacy productMatch string
  const byProduct = scheds.find(s => {
    const matches = s.productMatches && s.productMatches.length > 0
      ? s.productMatches
      : s.productMatch ? [s.productMatch] : []
    return matches.some(m => prod.includes(m.toLowerCase()))
  })
  return byProduct || scheds.find(s => s.isDefault) || scheds[0]
}

// ── Modals ────────────────────────────────────────────────────────────────────
// ── Inline editable field ─────────────────────────────────────────────────────
// ── Activity timeline ─────────────────────────────────────────────────────────

/** How many rows of a group show before the rep asks for the rest. */
const ACTIVITY_PREVIEW = 3

function actDate(iso: string): string {
  const d = new Date(iso)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString('nl-NL', {
    day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }),
  })
}

function actDateTime(iso: string): string {
  const d = new Date(iso)
  return `${actDate(iso)} ${d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}`
}

/**
 * Each group gets its own columns: what matters about an email is not what
 * matters about a call. Status values are shown as HubSpot returns them
 * (BOUNCED, NO_ANSWER, NO_SHOW) so they match the record exactly; direction is
 * derived, because HubSpot's raw values there are unreadable.
 */
type Slots = [string, string, string, string]

interface GroupDef {
  kind: ActivityKind
  icon: string
  titleKey: string
  /** Four fixed slots so every group lines up: when · wie/soort · inhoud · status. */
  headerKeys: Slots
  cells: (a: Activity) => Slots
  /** Slot carrying the content — gets .tn (bold, ellipsised); rest get .tm. */
  mainCol: number
}

/**
 * One shared column grid for every group, sized off the widest (four columns).
 * Groups that do not use a slot leave it blank rather than collapsing it, so
 * dates sit under dates and statuses under statuses right down the section.
 */
const ACTIVITY_COLS = (
  <colgroup>
    <col style={{ width: 130 }} />
    <col style={{ width: 150 }} />
    <col />
    <col style={{ width: 170 }} />
  </colgroup>
)

// .tn caps at 200px, which fights the fixed grid — the col width should win.
const ACTIVITY_CELL: React.CSSProperties = {
  maxWidth: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}

const ACTIVITY_GROUPS: GroupDef[] = [
  {
    kind: 'email', icon: '✉', titleKey: 'actEmails',
    headerKeys: ['actDateTime', 'actDirection', 'actSubject', 'actStatus'],
    cells: a => [actDateTime(a.at), a.direction || '--', a.title || '--', a.status || '--'],
    mainCol: 2,
  },
  {
    kind: 'call', icon: '☎', titleKey: 'actCalls',
    // No call title: it is usually auto-generated and says less than the
    // direction and duration already do.
    headerKeys: ['actDateTime', 'actDirection', 'actDuration', 'actResult'],
    cells: a => [actDateTime(a.at), a.direction || '--', a.duration || '--', a.status || '--'],
    mainCol: 3,
  },
  {
    kind: 'meeting', icon: '📅', titleKey: 'actMeetings',
    headerKeys: ['actDateTime', '', 'actSubject', 'actOutcome'],
    cells: a => [actDateTime(a.at), '', a.title || '--', a.status || '--'],
    mainCol: 2,
  },
  {
    kind: 'note', icon: '✎', titleKey: 'actNotes',
    // Date only: a note is not a moment in a conversation the way a call is.
    headerKeys: ['actDate', 'actFrom', 'actFirstLine', ''],
    cells: a => [actDate(a.at), a.author || '--', a.title || '--', ''],
    mainCol: 2,
  },
  {
    kind: 'marketing', icon: '📣', titleKey: 'actMarketing',
    // Status is the furthest the recipient got: SENT → DELIVERED → OPEN → CLICK,
    // or a failure such as BOUNCE.
    headerKeys: ['actDateTime', '', 'actSubject', 'actStatus'],
    cells: a => [actDateTime(a.at), '', a.title || '--', a.status || '--'],
    mainCol: 2,
  },
]

function ActivityGroup({
  def, items, lang,
}: { def: GroupDef; items: Activity[]; lang: 'nl' | 'en' }) {
  const t = (k: string, ...a: any[]) => translate(lang, k, ...a)
  const [showAll, setShowAll] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  // The fetch returns one row past the cap purely as a truncation signal, so
  // the extra row is dropped here and reported as "7+" instead.
  const truncated = items.length > ACTIVITY_CAP
  const rows = items.slice(0, ACTIVITY_CAP)
  const visible = showAll ? rows : rows.slice(0, ACTIVITY_PREVIEW)
  const hidden = rows.length - visible.length

  return (
    <div style={{ marginTop: 10 }}>
      <div className="sl2" style={{ marginBottom: 4 }}>
        {def.icon} {t(def.titleKey)}{' '}
        <span style={{ color: 'var(--cs)' }}>({rows.length}{truncated ? '+' : ''})</span>
      </div>
      <table style={{ tableLayout: 'fixed', width: '100%' }}>
        {ACTIVITY_COLS}
        <thead>
          {/* An unused slot keeps its cell so the grid holds across groups. */}
          <tr>{def.headerKeys.map((k, i) => <th key={i}>{k ? t(k) : ''}</th>)}</tr>
        </thead>
        <tbody>
          {visible.map(a => {
            const isOpen = openId === a.id
            const cells = def.cells(a)
            return (
              <Fragment key={a.id}>
                <tr
                  style={{ cursor: a.body ? 'pointer' : 'default' }}
                  onClick={() => a.body && setOpenId(isOpen ? null : a.id)}
                >
                  {cells.map((c, i) => (
                    <td key={i} className={i === def.mainCol ? 'tn' : 'tm'} style={ACTIVITY_CELL} title={c}>
                      {i === def.mainCol && a.body
                        ? <>{c} <span style={{ color: 'var(--cs)' }}>{isOpen ? '▾' : '▸'}</span></>
                        : c}
                    </td>
                  ))}
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={cells.length} style={{
                      fontSize: 12, color: 'var(--cs)', whiteSpace: 'pre-wrap',
                      padding: '6px 8px', background: 'var(--c2)',
                    }}>{a.body}</td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
      {hidden > 0 && (
        <button className="btn btn-sc btn-xs" style={{ marginTop: 4 }} onClick={() => setShowAll(true)}>
          {t('actShowAll', String(rows.length))}
        </button>
      )}
      {showAll && rows.length > ACTIVITY_PREVIEW && (
        <button className="btn btn-sc btn-xs" style={{ marginTop: 4 }} onClick={() => setShowAll(false)}>
          {t('actShowLess')}
        </button>
      )}
      {/* Only worth saying when there is genuinely more than the cap shows. */}
      {truncated && (
        <div style={{ fontSize: 11, color: 'var(--cs)', marginTop: 4 }}>{t('actMore')}</div>
      )}
    </div>
  )
}

/**
 * Recent communication on the lead's contact, so a rep can see what has already
 * been said without leaving for HubSpot.
 *
 * Loaded when the modal opens rather than on expand: the point is that the rep
 * sees there is history at all. Collapsed by default so it never pushes the
 * playbook down the page. Empty groups are dropped — four headings reading
 * "geen" would eat exactly the space the preview cap is saving.
 */
function ActivityTimeline({ contactId, contactEmail, lang }: { contactId: string; contactEmail: string; lang: 'nl' | 'en' }) {
  const t = (k: string, ...a: any[]) => translate(lang, k, ...a)
  const [groups, setGroups] = useState<ActivityGroups | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchContactActivity(contactId, contactEmail).then(g => { if (!cancelled) setGroups(g) })
    return () => { cancelled = true }
  }, [contactId, contactEmail])

  // Substituting an empty set rather than narrowing: TypeScript will not
  // reliably carry a `groups !== null` check into the callbacks below.
  const g: ActivityGroups = groups ?? { email: [], call: [], note: [], meeting: [], marketing: [] }
  const total = ACTIVITY_GROUPS.reduce((n, def) => n + Math.min(g[def.kind].length, ACTIVITY_CAP), 0)
  const anyTruncated = ACTIVITY_GROUPS.some(def => g[def.kind].length > ACTIVITY_CAP)
  const filled = ACTIVITY_GROUPS.filter(def => g[def.kind].length > 0)

  return (
    <div>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setOpen(o => !o)}
      >
        <div className="sl2">{t('activityTitle')}</div>
        <span style={{ fontSize: 11, color: 'var(--cs)' }}>
          {groups === null ? '…' : `(${total}${anyTruncated ? '+' : ''})`}
        </span>
        <span style={{ fontSize: 11, color: 'var(--cs)' }}>{open ? '▾' : '▸'}</span>
      </div>

      {open && groups !== null && total === 0 && (
        <div style={{ fontSize: 12, color: 'var(--cs)', padding: '6px 0' }}>{t('activityNone')}</div>
      )}

      {open && groups !== null && filled.map(def => (
        <ActivityGroup key={def.kind} def={def} items={g[def.kind]} lang={lang} />
      ))}
    </div>
  )
}
/**
 * PostNL Adrescheck outcome, shown next to the address heading.
 *
 * Red means the address itself is wrong and the rep should fix it. Error is
 * grey on purpose: the check failed, which is not something the rep can act on,
 * and colouring it red would send them hunting for a problem in the address.
 *
 * Keyed lowercase so a difference in casing between HubSpot and this map cannot
 * silently blank the badge.
 */
const ADDRESS_CHECK_STATES: Record<string, { color: string; key: string }> = {
  'matched':      { color: 'var(--gr)', key: 'addrCheckMatched' },
  'needs review': { color: 'var(--or)', key: 'addrCheckReview' },
  'no match':     { color: 'var(--rd)', key: 'addrCheckNoMatch' },
  'error':        { color: 'var(--gm)', key: 'addrCheckError' },
}

/** PostNL's public address lookup — where reps go to check an address by hand. */
const POSTNL_LOOKUP_URL = 'https://www.postnl.nl/adres-zoeken/'

function AddressCheckBadge({ status, lang }: { status: string; lang: 'nl' | 'en' }) {
  const value = (status || '').trim()
  // Before the check has run there is nothing worth saying.
  if (!value) return null
  const state = ADDRESS_CHECK_STATES[value.toLowerCase()]
  // An unmapped value renders raw rather than disappearing, so a new HubSpot
  // option shows up as something odd instead of as nothing at all.
  const label = `${translate(lang, 'addrCheckPrefix')} ${state ? translate(lang, state.key) : value}`

  const dot = (
    <span style={{
      width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
      background: state?.color ?? 'var(--gm)',
    }} />
  )
  const base: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    fontSize: 11, color: 'var(--cs)',
  }

  // A clean match needs no action. Every other state — including an unmapped
  // one — links out so the rep can verify the address themselves mid-call.
  if (state?.key === 'addrCheckMatched') {
    return <span style={base} title={`PostNL Adrescheck: ${value}`}>{dot}{label}</span>
  }
  return (
    <a
      href={POSTNL_LOOKUP_URL}
      target="_blank"
      rel="noreferrer"
      title={`PostNL Adrescheck: ${value} — ${translate(lang, 'addrCheckLookup')}`}
      style={{ ...base, textDecoration: 'underline' }}
    >
      {dot}{label} ↗
    </a>
  )
}

function EditableField({ label, value, onSave, highlight = false }: { label: string; value: string; onSave: (v: string) => Promise<void>; highlight?: boolean }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(value) }, [value])
  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  async function save() {
    const trimmed = draft.trim()
    if (trimmed === value) { setEditing(false); return }
    setSaving(true)
    try { await onSave(trimmed) } finally { setSaving(false); setEditing(false) }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); save() }
    if (e.key === 'Escape') { setDraft(value); setEditing(false) }
  }

  return (
    <div
      className="kv"
      style={{
        alignItems: 'center',
        // Highlighted when this field is blocking a home visit — draws the eye
        // straight to what needs filling in, rather than relying on the toast.
        ...(highlight ? {
          background: 'rgba(247,102,34,0.10)',
          border: '1px solid var(--or)',
          borderRadius: 6,
          padding: '2px 6px',
          margin: '-2px -6px',
        } : {}),
      }}
    >
      <span className="kk" style={{ flexShrink: 0 }}>{label}</span>
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={onKeyDown}
          disabled={saving}
          style={{
            flex: 1, fontSize: 12, padding: '2px 6px', borderRadius: 5,
            border: '1px solid var(--cp)', background: 'var(--bg)', color: 'var(--tx)',
            outline: 'none', minWidth: 0,
          }}
        />
      ) : (
        <span
          className="vv"
          title="Click to edit"
          onClick={() => setEditing(true)}
          style={{ cursor: 'text', flex: 1 }}
        >
          {value || <span style={{ color: 'var(--cs)', fontStyle: 'italic' }}>--</span>}
          {' '}
          <span style={{ fontSize: 10, color: 'var(--cs)', opacity: 0.7 }}>✎</span>
        </span>
      )}
    </div>
  )
}

function LostModal({ dealId, lang }: { dealId: string; lang: 'nl' | 'en' }) {
  const { state, setState } = useApp()
  const t = (k: string, ...a: any[]) => translate(lang, k, ...a)
  const [options, setOptions] = useState<Array<{ label: string; value: string }>>([])
  const [selected, setSelected] = useState<string>('')

  useEffect(() => {
    fetchLeadPropertyOptions(CONFIG.PROPS.lostReasons).then(opts => {
      if (opts.length > 0) {
        setOptions(opts)
      } else {
        setOptions(translateArr(lang, 'lostReasons').map(o => ({ label: o, value: o })))
      }
    })
  }, [])

  async function confirmLost() {
    if (!selected) { showToast(t('errReason'), 'error'); return }
    try {
      await patchLeadApi(dealId, {
        hs_pipeline_stage: CONFIG.STAGES.LOST,
        [CONFIG.PROPS.lostReasons]: selected,
        [CONFIG.PROPS.callResult]: 'Lost',
      }, state.leads, leads => setState({ leads }))
      setState({ leads: state.leads.filter(l => l.id !== dealId), selectedId: null, modal: null })
      showToast(t('toastLost'), 'success')
    } catch (e: any) {
      showToast(t('errLoad', e.message), 'error')
    }
  }

  return (
    <div className="mb" onClick={e => { if (e.target === e.currentTarget) setState({ modal: null }) }}>
      <div className="mo">
        <div className="moh">
          <div className="mot">{t('lostTitle')}</div>
          <button className="xb" onClick={() => setState({ modal: null })}>✕</button>
        </div>
        <div className="mob">
          <div className="iw">
            <label className="il">{t('lostReason')} <span style={{ color: 'var(--rd)' }}>*</span></label>
            <select className="sel" value={selected} onChange={e => setSelected(e.target.value)}>
              <option value="">--</option>
              {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
        <div className="mof">
          <button className="btn btn-sc btn-sm" onClick={() => setState({ modal: null })}>{t('cancel')}</button>
          <button className="btn btn-dn btn-sm" onClick={confirmLost} disabled={!selected}>
            {t('confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

function SchedModal({ deal, lang, onBooked }: { deal: Deal; lang: 'nl' | 'en'; onBooked: () => void }) {
  const { state, setState } = useApp()
  const t = (k: string, ...a: any[]) => translate(lang, k, ...a)
  const sched = getScheduler(deal, state.schedulers)
  const [confirming, setConfirming] = useState(false)

  // Prefill the scheduler with the customer's details so the rep doesn't have
  // to type them while on the phone. Fetched on open rather than upfront — only
  // one lead is ever being scheduled at a time.
  const [contact, setContact] = useState<Awaited<ReturnType<typeof fetchLeadContact>>>(null)
  const [loadingContact, setLoadingContact] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetchLeadContact(deal.id)
      .then(c => { if (!cancelled) setContact(c) })
      .finally(() => { if (!cancelled) setLoadingContact(false) })
    return () => { cancelled = true }
  }, [deal.id])

  const schedUrl = sched ? buildSchedulerUrl(sched.url, contact) : ''

  // HubSpot's meetings iframe posts a message to the parent window when a
  // booking succeeds. Listening for it sets the call result at the moment the
  // appointment is actually made, instead of relying on the rep answering the
  // "Afspraak gemaakt?" prompt afterwards.
  //
  // The manual prompt is kept as a fallback: a rep who books via "Open planner"
  // (new tab) is outside this window, so no message reaches us there.
  useEffect(() => {
    if (!sched) return
    let expectedOrigin = ''
    try { expectedOrigin = new URL(sched.url).origin } catch { /* malformed URL configured in Admin */ }

    function onMessage(e: MessageEvent) {
      // Only trust messages from the scheduler's own origin.
      if (expectedOrigin && e.origin !== expectedOrigin) return
      if (!e.data || typeof e.data !== 'object') return
      if ((e.data as { meetingBookSucceeded?: boolean }).meetingBookSucceeded !== true) return
      onBooked()
      setState({ modal: null })
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [sched?.url, onBooked, setState])

  function handleClose() {
    setConfirming(true)
  }

  function handleBooked(yes: boolean) {
    setConfirming(false)
    if (yes) onBooked()
    setState({ modal: null })
  }

  return (
    <div className="mb" onClick={e => { if (e.target === e.currentTarget) handleClose() }}>
      <div className="mo">
        <div className="moh">
          <div className="mot">{sched?.name || t('schedTitle')}</div>
          <button className="xb" onClick={handleClose}>✕</button>
        </div>
        <div className="mob">
          {!sched
            ? <div className="wb">⚙️ {t('noSchedCfg')}</div>
            : (
              <>
                <a href={schedUrl} target="_blank" rel="noreferrer" className="btn btn-pr btn-md btn-full" style={{ textDecoration: 'none' }}>
                  {t('openSched')}
                </a>
                {/* Wait for the contact fetch before rendering the iframe — the
                    scheduler reads its prefill params on load, so mounting it
                    early would show empty fields and never refill them. */}
                {loadingContact
                  ? <div className="wb" style={{ height: 360, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>…</div>
                  : <iframe src={schedUrl} style={{ width: '100%', height: 360, border: 'none', borderRadius: 10, outline: '1px solid var(--gl)' }} />
                }
              </>
            )
          }
        </div>
        <div className="mof">
          <button className="btn btn-sc btn-sm" onClick={handleClose}>{t('close')}</button>
        </div>
      </div>
      {/* Booking confirmation overlay */}
      {confirming && (
        <div className="mb" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={e => e.stopPropagation()}>
          <div className="mo" style={{ maxWidth: 380 }}>
            <div className="moh">
              <div className="mot">{t('schedBooked')}</div>
            </div>
            <div className="mob" style={{ textAlign: 'center', padding: '16px 0' }}>
              <p style={{ marginBottom: 16, color: 'var(--tx)' }}>{t('schedBookedQ')}</p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                <button className="btn btn-gn btn-sm" onClick={() => handleBooked(true)}>{t('yes')}</button>
                <button className="btn btn-sc btn-sm" onClick={() => handleBooked(false)}>{t('no')}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── CallOutcome section ───────────────────────────────────────────────────────
function CallOutcomeSection({ dealId, lang }: { dealId: string; lang: 'nl' | 'en' }) {
  const { state, getPbState, setCallOutcome, setCallOutcomeNote, patchLeadLocal } = useApp()
  const t = (k: string, ...a: any[]) => translate(lang, k, ...a)
  const pbSt = getPbState(dealId)
  const deal = state.leads.find(l => l.id === dealId)
  const savedOutcome = deal?.properties?.[CONFIG.PROPS.callOutcome]
  const [options, setOptions] = useState<Array<{ label: string; value: string }>>([])

  useEffect(() => {
    fetchLeadPropertyOptions(CONFIG.PROPS.callOutcome).then(opts => {
      if (opts.length > 0) {
        setOptions(opts)
      } else {
        setOptions(translateArr(lang, 'callOutcomes').map(o => ({ label: o, value: o })))
      }
    })
  }, [])

  async function handleChange(value: string) {
    setCallOutcome(dealId, value)
    if (!value) return
    try {
      await patchLeadApi(dealId, { [CONFIG.PROPS.callOutcome]: value }, state.leads, leads => {
        patchLeadLocal(dealId, { [CONFIG.PROPS.callOutcome]: value })
      })
      patchLeadLocal(dealId, { [CONFIG.PROPS.callOutcome]: value })
      showToast(t('toastSaved'), 'success')
    } catch (e: any) {
      showToast(t('errLoad', e.message), 'error')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="sl2">{lang === 'nl' ? 'Call outcome' : 'Call outcome'}</div>
      <select
        className="inp"
        value={pbSt.callOutcome || savedOutcome || ''}
        onChange={e => handleChange(e.target.value)}
        style={{ width: '100%' }}
      >
        <option value="">{lang === 'nl' ? '-- Selecteer uitkomst --' : '-- Select outcome --'}</option>
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

// ── DealModal ─────────────────────────────────────────────────────────────────
export default function DealModal() {
  const { state, setState, selectLead, patchLeadLocal } = useApp()
  const lang = state.lang
  const t = (k: string, ...a: any[]) => translate(lang, k, ...a)

  const cardRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ type: 'move' | 'resize'; sx: number; sy: number; sw: number; sh: number; sl: number; st: number } | null>(null)

  // ── Drag / resize — must be before the early return to avoid hooks-order violation ──
  const startDrag = useCallback((e: React.MouseEvent, type: 'move' | 'resize') => {
    e.preventDefault()
    e.stopPropagation()
    const card = cardRef.current
    if (!card) return
    const r = card.getBoundingClientRect()
    dragRef.current = { type, sx: e.clientX, sy: e.clientY, sw: r.width, sh: r.height, sl: r.left, st: r.top }
    // Commit current position to state for pixel-accurate dragging
    setState({ dmX: r.left, dmY: r.top, dmW: r.width, dmH: r.height })
    card.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;max-width:none;max-height:none;`

    const onMove = (me: MouseEvent) => {
      if (!dragRef.current) return
      me.preventDefault()
      const dx = me.clientX - dragRef.current.sx
      const dy = me.clientY - dragRef.current.sy
      const c = cardRef.current
      if (!c) return
      const vw = window.innerWidth, vh = window.innerHeight
      if (dragRef.current.type === 'move') {
        const nx = Math.max(0, Math.min(dragRef.current.sl + dx, vw - 120))
        const ny = Math.max(0, Math.min(dragRef.current.st + dy, vh - 60))
        c.style.left = nx + 'px'; c.style.top = ny + 'px'
      } else {
        const nw = Math.max(420, Math.min(dragRef.current.sw + dx, vw))
        const nh = Math.max(300, Math.min(dragRef.current.sh + dy, vh))
        c.style.width = nw + 'px'; c.style.height = nh + 'px'
      }
    }
    const onUp = () => {
      dragRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove, { passive: false })
    document.addEventListener('mouseup', onUp)
  }, [setState])

  // Address fields currently blocking a home visit — highlighted inline so the
  // rep can see exactly what to fill without hunting for it.
  // Declared here with the other hooks: must be above the early return below,
  // or React's hook order breaks when no deal is selected.
  const [hvMissing, setHvMissing] = useState<string[]>([])

  // ── Deal-specific setup (after hooks) ──────────────────────────────────────
  const deal = state.leads.find(l => l.id === state.selectedId)
  if (!deal) return null

  // Capture id so closures below don't re-evaluate the possibly-undefined find result
  const dealId = deal.id
  const p = deal.properties
  const P = CONFIG.PROPS
  const pbDefs = getPlaybookDefs(deal, state.playbooks.length > 0 ? state.playbooks : undefined)

  function closeDeal() {
    selectLead(null)
    setState({ dmX: null, dmY: null, dmW: null, dmH: null })
  }

  function openLost() {
    setState({ modal: 'lost', modalDealId: dealId })
  }

  function openSched() {
    setState({ modal: 'sched', modalDealId: dealId })
  }

  function openCreateTask() {
    setState({
      taskModal: 'create',
      taskDraft: { dealId: dealId, assigneeEmail: state.currentRep?.email || '', title: '', dueDate: '', note: '' },
    })
  }

  async function handleCallResult(value: string) {
    // Plan HV needs a resolvable address: the home-visit scheduler can't produce
    // a URL without one. Postcode + house number are the required pair — PostNL
    // Adrescheck backfills street and city from those two. House number suffix
    // stays optional (many addresses don't have one, though it's often needed in
    // NL to pin down the exact address — reps can add it inline above).
    //
    // Guarding here matters because Plan HV is not a reversible click: it writes
    // the call result, which moves the lead to SQL and creates a deal. Without an
    // address the rep then waits ~3 minutes on a polling overlay and ends up with
    // a converted lead and no home visit booked.
    if (value === 'Plan HV') {
      const missingProps: string[] = []
      const missingLabels: string[] = []
      if (!String(p['postal_code'] || '').trim())  { missingProps.push('postal_code');  missingLabels.push(t('postalCode')) }
      if (!String(p['house_number'] || '').trim()) { missingProps.push('house_number'); missingLabels.push(t('houseNumber')) }
      if (missingProps.length > 0) {
        // Always flag the suffix too — it's optional to fill, but address quality
        // decides whether job creation passes verification in the backend later.
        setHvMissing([...missingProps, 'house_number_suffix'])
        showToast(t('hvAddressRequired', missingLabels.join(', ')), 'error', 9000)
        return
      }
      setHvMissing([])
    }

    const needsDeal = value === 'Plan HV' || value === 'Plan Call'
    if (needsDeal) {
      // Show loading overlay immediately — global state so it survives DealModal unmounting
      setState({ dealLoading: true, dealNotif: null })
    }
    try {
      await patchLeadApi(dealId, { [CONFIG.PROPS.callResult]: value }, state.leads, leads => setState({ leads }))
      patchLeadLocal(dealId, { [CONFIG.PROPS.callResult]: value })
      if (needsDeal) {
        // Poll for associated deal — HubSpot creates it ~30s after lead moves to SQL
        const capturedLang = lang
        const MAX_ATTEMPTS = 24   // 24 × 5s = 120s total
        const INTERVAL_MS = 5000
        let attempts = 0
        const poll = async (): Promise<void> => {
          attempts++
          const found = await fetchAssociatedDeal(dealId)
          if (found) {
            if (value === 'Plan HV') {
              // Show banner immediately; poll separately for HV URL (~20s to populate)
              setState({
                dealLoading: false,
                dealNotif: { id: found.id, name: found.name, hvSchedulerUrl: found.hvSchedulerUrl, hvSchedulerLoading: !found.hvSchedulerUrl },
              })
              if (!found.hvSchedulerUrl) {
                let hvAttempts = 0
                const HV_URL_MAX = 12 // 12 × 5s = 60s
                const pollHvUrl = async (): Promise<void> => {
                  hvAttempts++
                  const updated = await fetchAssociatedDeal(dealId)
                  if (updated?.hvSchedulerUrl) {
                    setState({ dealNotif: { id: found.id, name: found.name, hvSchedulerUrl: updated.hvSchedulerUrl, hvSchedulerLoading: false } })
                    return
                  }
                  if (hvAttempts < HV_URL_MAX) {
                    setTimeout(pollHvUrl, 5000)
                  } else {
                    setState({ dealNotif: { id: found.id, name: found.name, hvSchedulerUrl: null, hvSchedulerLoading: false } })
                  }
                }
                setTimeout(pollHvUrl, 5000)
              }
            } else {
              setState({
                dealLoading: false,
                dealNotif: { id: found.id, name: found.name, hvSchedulerUrl: null },
              })
            }
            return
          }
          if (attempts < MAX_ATTEMPTS) {
            setTimeout(poll, INTERVAL_MS)
          } else {
            setState({ dealLoading: false })
            showToast(capturedLang === 'nl' ? 'Deal nog niet beschikbaar' : 'Deal not yet available — check HubSpot shortly', 'error')
          }
        }
        poll()
      } else {
        showToast(value, 'success')
      }
    } catch (e: any) {
      setState({ dealLoading: false })
      showToast(t('errLoad', e.message), 'error')
    }
  }

  const cardStyle: React.CSSProperties = state.dmX != null
    ? { position: 'fixed', left: state.dmX, top: state.dmY!, width: state.dmW!, height: state.dmH!, maxWidth: 'none', maxHeight: 'none' }
    : {}

  const sched = getScheduler(deal, state.schedulers)
  const schedLabel = sched?.buttonLabel || t('schedVC')
  const openTasks = dealOpenTasks(deal.id)

  return (
    <>
      <div
        className="dm-overlay"
        onClick={e => { if (e.target === e.currentTarget) closeDeal() }}
      >
        <div
          ref={cardRef}
          className="dm-card pop-in"
          style={cardStyle}
        >
          {/* Header — drag handle */}
          <div className="dm-head" onMouseDown={e => startDrag(e, 'move')}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="dm-title" title={p.hs_lead_name || ''}>{p.hs_lead_name || '--'}</div>
                <div className="dm-sub">{p[P.product] || '--'}</div>
              </div>
              <button
                className="xb"
                style={{ flexShrink: 0, marginLeft: 10, pointerEvents: 'auto' }}
                onMouseDown={e => e.stopPropagation()}
                onClick={closeDeal}
              >✕</button>
            </div>
            <div className="dm-meta">
              <span className="dm-phone">{p.phone_number || '--'}</span>
              {p.phone_number && (
                <a
                  href={`tel:${p.phone_number.replace(/\s/g, '')}`}
                  className="btn btn-pr btn-sm"
                  onMouseDown={e => e.stopPropagation()}
                  style={{ pointerEvents: 'auto', textDecoration: 'none' }}
                >
                  {t('callBtn')}
                </a>
              )}
            </div>
          </div>

          {/* Scrollable body */}
          <div className="dm-body">
            {/* Lead info + Address side by side */}
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
              {/* Left: lead info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="sl2">{t('leadInfo')}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <div className="kv"><span className="kk">{t('origin')}</span><span className="vv">{p[P.formOrigin] || '--'}</span></div>
                  <div className="kv"><span className="kk">{t('product')}</span><span className="vv">{p[P.product] || '--'}</span></div>
                  <div className="kv"><span className="kk">{t('reqAt')}</span><span className="vv">{relTime(p[P.requestedAt])}</span></div>
                </div>
              </div>
              {/* Right: editable address */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <div className="sl2">{t('address')}</div>
                    <AddressCheckBadge status={p['postnl_adrescheck_status'] || ''} lang={lang} />
                  </div>
                  {/* Straight to the contact in HubSpot — reps need the activity
                      history, which lives on the contact, not the lead. Uses the
                      lead's own hs_primary_contact_id so no extra lookup is needed. */}
                  {p['hs_primary_contact_id'] && state.hubspotPortalId && (
                    <a
                      className="btn btn-sc btn-xs"
                      href={`https://app-eu1.hubspot.com/contacts/${state.hubspotPortalId}/record/0-1/${p['hs_primary_contact_id']}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ textDecoration: 'none', whiteSpace: 'nowrap' }}
                    >
                      {t('openContact')}
                    </a>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {([
                    { label: t('street'),            prop: 'street_lead' },
                    { label: t('houseNumber'),       prop: 'house_number' },
                    { label: t('houseNumberSuffix'), prop: 'house_number_suffix' },
                    { label: t('postalCode'),        prop: 'postal_code' },
                    { label: t('city'),              prop: 'city' },
                  ] as Array<{ label: string; prop: string }>).map(({ label, prop }) => (
                    <EditableField
                      key={prop}
                      label={label}
                      value={p[prop] || ''}
                      highlight={hvMissing.includes(prop)}
                      onSave={async (val) => {
                        await patchLeadApi(dealId, { [prop]: val }, state.leads, leads => setState({ leads }))
                        patchLeadLocal(dealId, { [prop]: val })
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Recent communication, when we know which contact the lead is.
                Activities live on the contact, so without one there is nothing
                to show. */}
            {p['hs_primary_contact_id'] && (
              <>
                <div className="dv" />
                <ActivityTimeline
                  contactId={p['hs_primary_contact_id']}
                  contactEmail={p['contact_email'] || ''}
                  lang={lang}
                />
              </>
            )}

            <div className="dv" />

            {/* Call outcome — always visible */}
            <CallOutcomeSection dealId={deal.id} lang={lang} />

            <div className="dv" />

            {/* Playbook — pbDefs is empty only when there are genuinely no
                playbooks to show. Leads without a product get all playbooks
                (see getPlaybookDefs) so the rep can pick. */}
            {pbDefs.length > 0 && (
              <>
                <div className="dv" />
                <div className="sl2">{t('pbLabel')}</div>
                <PlaybookView
                  dealId={deal.id}
                  pbDefs={pbDefs.map(pi => ({ key: pi.key, def: pi.def }))}
                />
              </>
            )}
          </div>

          {/* Footer */}
          <div className="dm-foot" style={{ position: 'relative' }}>
            <button className="btn btn-gn btn-sm" onClick={() => handleCallResult('Plan HV')}>{t('homeVisit')}</button>
            <button className="btn btn-sc btn-sm" onClick={openSched}>{schedLabel}</button>
            <button className="btn btn-dn btn-sm" onClick={openLost}>{t('markLost')}</button>
            <button className="btn btn-sc btn-sm" onMouseDown={e => e.stopPropagation()} onClick={openCreateTask}>
              {t('taskAddFromDeal')}
              {openTasks.length > 0 && <span className="task-badge">{openTasks.length}</span>}
            </button>
            {/* Resize grip */}
            <div className="dm-grip" onMouseDown={e => startDrag(e, 'resize')}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M11 1L1 11M11 6L6 11M11 11" stroke="#081412" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Nested modals */}
      {state.modal === 'lost' && state.modalDealId === deal.id && (
        <LostModal dealId={deal.id} lang={lang} />
      )}
      {state.modal === 'sched' && state.modalDealId === deal.id && (
        <SchedModal deal={deal} lang={lang} onBooked={() => handleCallResult('Plan Call')} />
      )}
    </>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function relTime(iso: string | undefined): string {
  if (!iso) return '--'
  const d = Date.now() - new Date(iso).getTime()
  if (d < 60000) return '<1m'
  if (d < 3600000) return Math.round(d / 60000) + 'm'
  if (d < 86400000) return Math.round(d / 3600000) + 'u'
  return new Date(iso).toLocaleDateString('nl-NL', { day: '2-digit', month: 'short' })
}
