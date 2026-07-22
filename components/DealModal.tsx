'use client'

import { useRef, useCallback } from 'react'
import { useApp } from '@/context/AppContext'
import { translate, translateArr } from '@/lib/i18n'
import { CONFIG } from '@/lib/config'
import { loadScheds } from '@/lib/storage'
import { patchLead as patchLeadApi, aircallDial } from '@/lib/hubspot'
import { getPlaybookDefs } from '@/lib/playbooks'
import { dealOpenTasks } from '@/lib/storage'
import { showToast } from './Toast'
import PlaybookView from './PlaybookView'
import type { Deal, Scheduler } from '@/lib/types'

function initials(name: string) {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

function getScheduler(deal: Deal): Scheduler | null {
  const scheds = loadScheds()
  if (!scheds.length) return null
  const prod = (deal?.properties?.[CONFIG.PROPS.product] || '').toLowerCase()
  return scheds.find(s => s.productMatch && prod.includes(s.productMatch.toLowerCase()))
    || scheds.find(s => s.isDefault)
    || scheds[0]
}

// ── Modals ────────────────────────────────────────────────────────────────────
function LostModal({ dealId, lang }: { dealId: string; lang: 'nl' | 'en' }) {
  const { state, setState } = useApp()
  const t = (k: string, ...a: any[]) => translate(lang, k, ...a)
  const selRef = useRef<HTMLSelectElement>(null)

  async function confirmLost() {
    const reason = selRef.current?.value || ''
    if (!reason) { showToast(t('errReason'), 'error'); return }
    try {
      await patchLeadApi(dealId, { hs_pipeline_stage: CONFIG.STAGES.LOST, lead_lost_status: reason }, state.leads, leads => setState({ leads }))
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
            <select className="sel" ref={selRef} defaultValue="">
              <option value="">--</option>
              {translateArr(lang, 'lostReasons').map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div className="iw">
            <label className="il">{t('lostNote')}</label>
            <textarea className="ta" rows={3} />
          </div>
        </div>
        <div className="mof">
          <button className="btn btn-sc btn-sm" onClick={() => setState({ modal: null })}>{t('cancel')}</button>
          <button className="btn btn-dn btn-sm" onClick={confirmLost}>{t('confirm')}</button>
        </div>
      </div>
    </div>
  )
}

function SchedModal({ deal, lang }: { deal: Deal; lang: 'nl' | 'en' }) {
  const { setState } = useApp()
  const t = (k: string, ...a: any[]) => translate(lang, k, ...a)
  const sched = getScheduler(deal)

  return (
    <div className="mb" onClick={e => { if (e.target === e.currentTarget) setState({ modal: null }) }}>
      <div className="mo">
        <div className="moh">
          <div className="mot">{sched?.name || t('schedTitle')}</div>
          <button className="xb" onClick={() => setState({ modal: null })}>✕</button>
        </div>
        <div className="mob">
          {!sched
            ? <div className="wb">⚙️ {t('noSchedCfg')}</div>
            : (
              <>
                <a href={sched.url} target="_blank" rel="noreferrer" className="btn btn-pr btn-md btn-full" style={{ textDecoration: 'none' }}>
                  {t('openSched')}
                </a>
                <iframe src={sched.url} style={{ width: '100%', height: 360, border: 'none', borderRadius: 10, outline: '1px solid var(--gl)' }} />
              </>
            )
          }
        </div>
        <div className="mof">
          <button className="btn btn-sc btn-sm" onClick={() => setState({ modal: null })}>{t('close')}</button>
        </div>
      </div>
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

  async function saveOutcome() {
    if (!pbSt.callOutcome) { showToast(t('errOutcome'), 'error'); return }
    try {
      await patchLeadApi(dealId, { [CONFIG.PROPS.callOutcome]: pbSt.callOutcome }, state.leads, leads => {
        patchLeadLocal(dealId, { [CONFIG.PROPS.callOutcome]: pbSt.callOutcome })
      })
      patchLeadLocal(dealId, { [CONFIG.PROPS.callOutcome]: pbSt.callOutcome })
      showToast(t('toastSaved'), 'success')
    } catch (e: any) {
      showToast(t('errLoad', e.message), 'error')
    }
  }

  return (
    <div className="co-section">
      <div className="cr2">
        {translateArr(lang, 'callOutcomes').map(o => (
          <button
            key={o}
            className={`chip ${pbSt.callOutcome === o ? 'on' : ''}`}
            onClick={() => setCallOutcome(dealId, o)}
          >
            {o}
          </button>
        ))}
      </div>
      <textarea
        className="inp"
        rows={2}
        placeholder={t('callNotesPlaceholder')}
        defaultValue={pbSt.callOutcomeNote || ''}
        onBlur={e => setCallOutcomeNote(dealId, e.target.value)}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button className="btn btn-bk btn-sm" onClick={saveOutcome}>{t('logOutcome')}</button>
        {savedOutcome && savedOutcome !== '--' && (
          <span className="co-saved">✓ {savedOutcome}</span>
        )}
      </div>
    </div>
  )
}

// ── DealModal ─────────────────────────────────────────────────────────────────
export default function DealModal() {
  const { state, setState, selectLead } = useApp()
  const lang = state.lang
  const t = (k: string, ...a: any[]) => translate(lang, k, ...a)

  const cardRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ type: 'move' | 'resize'; sx: number; sy: number; sw: number; sh: number; sl: number; st: number } | null>(null)

  const deal = state.leads.find(l => l.id === state.selectedId)
  if (!deal) return null

  // Capture id so closures below don't re-evaluate the possibly-undefined find result
  const dealId = deal.id
  const p = deal.properties
  const P = CONFIG.PROPS
  const pbDefs = getPlaybookDefs(deal)

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

  async function handleHV() {
    try {
      await patchLeadApi(dealId, { hs_pipeline_stage: CONFIG.STAGES.SQL }, state.leads, leads => setState({ leads }))
      // Lead moves to SQL → no longer in MQL view → remove from list
      setState({ leads: state.leads.filter(l => l.id !== dealId), selectedId: null, modal: null })
      showToast(t('toastHV'), 'success')
    } catch (e: any) {
      showToast(t('errLoad', e.message), 'error')
    }
  }

  // ── Drag / resize ──────────────────────────────────────────────────────────
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

  const cardStyle: React.CSSProperties = state.dmX != null
    ? { position: 'fixed', left: state.dmX, top: state.dmY!, width: state.dmW!, height: state.dmH!, maxWidth: 'none', maxHeight: 'none' }
    : {}

  const sched = getScheduler(deal)
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
                <button
                  className="btn btn-pr btn-sm"
                  onMouseDown={e => e.stopPropagation()}
                  onClick={() => aircallDial(p.phone_number)}
                  style={{ pointerEvents: 'auto' }}
                >
                  {t('callBtn')}
                </button>
              )}
            </div>
          </div>

          {/* Scrollable body */}
          <div className="dm-body">
            {/* Lead info */}
            <div className="sl2">{t('leadInfo')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div className="kv"><span className="kk">{t('origin')}</span><span className="vv">{p[P.formOrigin] || '--'}</span></div>
              <div className="kv"><span className="kk">{t('partner')}</span><span className="vv">{p[P.partner] || '--'}</span></div>
              <div className="kv"><span className="kk">{t('stage')}</span><span className="vv">{p.dealstage || '--'}</span></div>
              <div className="kv"><span className="kk">{t('reqAt')}</span><span className="vv">{relTime(p[P.requestedAt])}</span></div>
            </div>

            <div className="dv" />

            {/* Call outcome */}
            <div className="sl2">{t('callOutcomeLabel')}</div>
            <CallOutcomeSection dealId={deal.id} lang={lang} />

            <div className="dv" />

            {/* Playbook */}
            <div className="sl2">{t('pbLabel')}</div>
            <PlaybookView
              dealId={deal.id}
              pbDefs={pbDefs.map(pi => ({ key: pi.key, def: pi.def }))}
            />
          </div>

          {/* Footer */}
          <div className="dm-foot" style={{ position: 'relative' }}>
            <button className="btn btn-gn btn-sm" onClick={handleHV}>{t('homeVisit')}</button>
            <button className="btn btn-sc btn-sm" onClick={openSched}>{schedLabel}</button>
            <button className="btn btn-sc btn-sm" onMouseDown={e => e.stopPropagation()} onClick={openCreateTask}>
              {t('taskAddFromDeal')}
              {openTasks.length > 0 && <span className="task-badge">{openTasks.length}</span>}
            </button>
            <button className="btn btn-dn btn-sm" style={{ marginLeft: 'auto' }} onClick={openLost}>{t('markLost')}</button>
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
        <SchedModal deal={deal} lang={lang} />
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
