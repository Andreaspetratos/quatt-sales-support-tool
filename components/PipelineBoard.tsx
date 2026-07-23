'use client'

import { useEffect, useRef, useState } from 'react'
import { useApp } from '@/context/AppContext'
import { translate, translateArr } from '@/lib/i18n'
import { CONFIG, stageLabel, isDemo } from '@/lib/config'
import { requestLeads, fetchLeads, fetchPerformance, fetchOneLead, onLeadWrite, createHsTask, fetchHsTasks, completeHsTask, deleteHsTask, fetchAllOwners } from '@/lib/hubspot'
import { myOpenTasks, dealOpenTasks, createTask, completeTask, deleteTask, loadTasks, saveTasks } from '@/lib/storage'
import { showToast } from './Toast'
import DealModal from './DealModal'
import type { Lead, Task } from '@/lib/types'

// ── Helpers ───────────────────────────────────────────────────────────────────
function relTime(iso: string | undefined): string {
  if (!iso) return '--'
  const d = Date.now() - new Date(iso).getTime()
  if (d < 60000) return '<1m'
  if (d < 3600000) return Math.round(d / 60000) + 'm'
  if (d < 86400000) return Math.round(d / 3600000) + 'u'
  return new Date(iso).toLocaleDateString('nl-NL', { day: '2-digit', month: 'short' })
}

function scoreBadge(s: string | undefined): React.ReactNode {
  if (!s && s !== '0') return <span className="badge bg">--</span>
  const n = parseInt(s || '')
  if (isNaN(n)) return <span className="badge bg">--</span>
  return n >= 70
    ? <span className="badge bn">⚡{n}</span>
    : <span className="badge bnl">{n}</span>
}

function prodBadge(p: string | undefined): React.ReactNode {
  if (!p || p === '--') return <span className="badge bg">--</span>
  return <span className="badge bo">{p.length > 20 ? p.slice(0, 18) + '…' : p}</span>
}

// ── Performance drawer ────────────────────────────────────────────────────────
function PerfDrawer({ lang }: { lang: 'nl' | 'en' }) {
  const { state, setState } = useApp()
  const t = (k: string, ...a: any[]) => translate(lang, k, ...a)
  const pd = state.perfData?.[state.perfPeriod] || { processed: 0, sql: 0, lost: 0 }

  async function refresh() {
    setState({ perfLoading: true, perfData: null })
    try {
      const data = await fetchPerformance(state.currentRep?.hubspotOwnerId || '')
      setState({ perfData: data, perfLoading: false })
    } catch (e: any) {
      showToast(t('errLoad', e.message), 'error')
      setState({ perfLoading: false })
    }
  }

  const sqlPct  = pd.processed ? Math.round(pd.sql  / pd.processed * 100) : 0
  const lostPct = pd.processed ? Math.round(pd.lost / pd.processed * 100) : 0

  return (
    <>
      <div className="perf-bd" onClick={() => setState({ perfOpen: false })} />
      <div className="perf-dr">
        <div className="perf-hd">
          <span className="perf-ht">{t('myPerf')}</span>
          <button className="xb" style={{ background: 'rgba(255,255,255,.12)', color: '#fff' }} onClick={() => setState({ perfOpen: false })}>✕</button>
        </div>
        <div className="perf-tabs">
          {(['today', 'week', 'month'] as const).map(p => (
            <button
              key={p}
              className={`perf-tab ${state.perfPeriod === p ? 'on' : ''}`}
              onClick={() => setState({ perfPeriod: p })}
            >
              {t('perf_' + p)}
            </button>
          ))}
        </div>
        {state.perfLoading
          ? <div className="perf-loading"><div className="sp spd" /></div>
          : (
            <div className="perf-body">
              {/* ── Main stat: processed ── */}
              <div className="perf-tot">
                <span className="perf-tot-n">{pd.processed}</span>
                <span className="perf-tot-l">{t('perfProcessed')}</span>
              </div>

              {/* ── SQL stat ── */}
              <div className="perf-row" style={{ marginTop: 16 }}>
                <div className="perf-row-top">
                  <span className="perf-row-name">{t('perfSQL')}</span>
                  <span className="perf-row-val">
                    {pd.sql}
                    <span className="perf-row-pct">{sqlPct}%</span>
                  </span>
                </div>
                <div className="perf-bar-bg">
                  <div className="perf-bar-fill" style={{ width: sqlPct + '%', background: 'var(--gm)' }} />
                </div>
              </div>

              {/* ── Lost stat ── */}
              <div className="perf-row">
                <div className="perf-row-top">
                  <span className="perf-row-name">{t('perfLost')}</span>
                  <span className="perf-row-val">
                    {pd.lost}
                    <span className="perf-row-pct">{lostPct}%</span>
                  </span>
                </div>
                <div className="perf-bar-bg">
                  <div className="perf-bar-fill" style={{ width: lostPct + '%', background: '#ef4444' }} />
                </div>
              </div>

              {pd.processed === 0 && (
                <div className="perf-empty">{t('perfEmpty')}</div>
              )}

              <div className="perf-refresh">
                <button className="btn btn-sc btn-xs" onClick={refresh}>{t('perfRefresh')}</button>
              </div>
            </div>
          )
        }
      </div>
    </>
  )
}

// ── Create Task Modal ─────────────────────────────────────────────────────────
function CreateTaskModal({ lang }: { lang: 'nl' | 'en' }) {
  const { state, setState } = useApp()
  const t = (k: string, ...a: any[]) => translate(lang, k, ...a)
  const draft = state.taskDraft
  const linkedLead = state.leads.find(l => l.id === draft.dealId)
  const [owners, setOwners] = useState<Array<{ id: string; email: string; name: string }>>([])

  // Load all HubSpot owners once when modal opens
  useEffect(() => {
    fetchAllOwners().then(list => {
      setOwners(list)
      // Pre-select current rep if not already set
      if (!draft.assigneeOwnerId && state.currentRep?.hubspotOwnerId) {
        setState({ taskDraft: { ...state.taskDraft, assigneeOwnerId: state.currentRep.hubspotOwnerId } })
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function submit() {
    if (!draft.title?.trim()) { showToast(t('taskTitle') + ' is required', 'error'); return }
    const ownerId = draft.assigneeOwnerId || state.currentRep?.hubspotOwnerId || ''
    const leadId = draft.dealId || null
    // Save locally first (optimistic)
    createTask({ ...draft, creatorEmail: state.currentRep?.email || '' })
    setState({ taskModal: null, taskDraft: {} })
    showToast(t('toastSaved'), 'success')
    // Sync to HubSpot in background — surface real errors via toast
    if (ownerId) {
      const titleSnapshot = draft.title || ''
      createHsTask(titleSnapshot, draft.note || '', draft.dueDate || '', ownerId, leadId)
        .then(hsId => {
          if (!hsId) return
          // Back-patch the local task with the HubSpot ID
          const tasks = loadTasks()
          const task = [...tasks].reverse().find(t => !t.hsTaskId && t.title === titleSnapshot)
          if (task) { task.hsTaskId = hsId; task.id = hsId; saveTasks(tasks) }
        })
        .catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e)
          showToast('⚠ HubSpot: ' + msg, 'error')
          console.error('[task] HubSpot sync error:', msg)
        })
    } else {
      // No owner ID — task saved locally only, no HubSpot sync
      showToast('⚠ Geen owner ID — taak alleen lokaal opgeslagen', 'error')
    }
  }

  return (
    <div className="mb" onClick={e => { if (e.target === e.currentTarget) setState({ taskModal: null }) }}>
      <div className="mo pop-in">
        <div className="moh">
          <div className="mot">{t('taskNew')}</div>
          <button className="xb" onClick={() => setState({ taskModal: null })}>✕</button>
        </div>
        <div className="mob">
          <div className="iw">
            <label className="il">{t('taskTitle')} <span style={{ color: 'var(--rd)' }}>*</span></label>
            <input
              className="inp" type="text" placeholder={t('taskTitleHint')}
              defaultValue={draft.title || ''}
              onBlur={e => setState({ taskDraft: { ...state.taskDraft, title: e.target.value } })}
            />
          </div>
          <div className="iw">
            <label className="il">{t('taskDue')}</label>
            <input
              className="inp" type="date" defaultValue={draft.dueDate || ''}
              onBlur={e => setState({ taskDraft: { ...state.taskDraft, dueDate: e.target.value } })}
            />
          </div>
          <div className="iw">
            <label className="il">{t('taskAssign')}</label>
            <select
              className="sel"
              value={draft.assigneeOwnerId || state.currentRep?.hubspotOwnerId || ''}
              onChange={e => setState({ taskDraft: { ...state.taskDraft, assigneeOwnerId: e.target.value } })}
            >
              {owners.length === 0 && <option value={state.currentRep?.hubspotOwnerId || ''}>{state.currentRep?.name || '…'}</option>}
              {owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          {linkedLead && (
            <div className="iw">
              <label className="il">{t('taskDeal')}</label>
              <div style={{ fontSize: 13, color: 'var(--ct)', padding: '4px 0' }}>📋 {linkedLead.properties?.hs_lead_name || '--'}</div>
            </div>
          )}
          <div className="iw">
            <label className="il">{t('taskNote')}</label>
            <textarea className="ta" rows={3} defaultValue={draft.note || ''}
              onBlur={e => setState({ taskDraft: { ...state.taskDraft, note: e.target.value } })} />
          </div>
        </div>
        <div className="mof">
          <button className="btn btn-sc btn-sm" onClick={() => setState({ taskModal: null })}>{t('cancel')}</button>
          <button className="btn btn-pr btn-sm" onClick={submit}>{t('taskSave')}</button>
        </div>
      </div>
    </div>
  )
}

// ── Tasks tab ─────────────────────────────────────────────────────────────────
function TasksTab({ lang }: { lang: 'nl' | 'en' }) {
  const { state } = useApp()
  const t = (k: string, ...a: any[]) => translate(lang, k, ...a)
  const [, forceUpdate] = useState(0)
  const tasks = myOpenTasks(state.currentRep?.email).sort((a, b) => {
    if (!a.dueDate && !b.dueDate) return 0
    if (!a.dueDate) return 1
    if (!b.dueDate) return -1
    return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
  })

  function dueMeta(dueDate: string): { label: string; cls: string } {
    if (!dueDate) return { label: '', cls: '' }
    const d = new Date(dueDate), now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const due = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    const diff = Math.round((due.getTime() - today.getTime()) / 86400000)
    if (diff < 0) return { label: t('taskOverdue'), cls: 'task-due-over' }
    if (diff === 0) return { label: t('taskToday'), cls: 'task-due-today' }
    return { label: d.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short' }), cls: 'task-due-ok' }
  }

  if (!tasks.length) {
    return (
      <div className="es">
        <div className="ei">✅</div>
        <div className="et">{t('taskNone')}</div>
        <div className="es2">{t('taskNoneSub')}</div>
      </div>
    )
  }

  return (
    <div className="task-list fade-up">
      {tasks.map(task => {
        const dm = dueMeta(task.dueDate)
        const lead = state.leads.find(l => l.id === task.dealId)
        return (
          <div key={task.id} className={`task-card ${dm.cls === 'task-due-over' ? 'overdue' : ''}`}>
            <div className="task-card-title">{task.title || '(no title)'}</div>
            {task.note && <div className="task-card-note">{task.note}</div>}
            <div className="task-card-meta">
              {dm.label && <span className={`task-card-due ${dm.cls}`}>{dm.label}</span>}
              {lead && <span className="task-card-deal">📋 {lead.properties?.hs_lead_name || '--'}</span>}
            </div>
            <div className="task-card-actions">
              <button className="btn btn-gn btn-xs" onClick={async () => {
                completeTask(task.id)
                forceUpdate(n => n + 1)
                if (task.hsTaskId) await completeHsTask(task.hsTaskId)
              }}>{t('taskDone')}</button>
              <button className="btn btn-dn btn-xs" onClick={async () => {
                deleteTask(task.id)
                forceUpdate(n => n + 1)
                if (task.hsTaskId) await deleteHsTask(task.hsTaskId)
              }}>{t('taskDelete')}</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Deals table ───────────────────────────────────────────────────────────────
function DealsTable({ lang }: { lang: 'nl' | 'en' }) {
  const { state, selectLead } = useApp()
  const t = (k: string, ...a: any[]) => translate(lang, k, ...a)
  const P = CONFIG.PROPS

  if (!state.leads.length) {
    return (
      <div className="es">
        <div className="ei">📋</div>
        <div className="et">{t('noLeads')}</div>
        <div className="es2">{t('noLeadsSub')}</div>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      <table>
        <thead>
          <tr>
            <th>{t('colName')}</th>
            <th>{t('colTime')}</th>
            <th>{t('colPhone')}</th>
            <th>{t('colProduct')}</th>
            <th>{t('colOutcome')}</th>
            <th>Stage</th>
          </tr>
        </thead>
        <tbody>
          {state.leads.map(deal => {
            const p = deal.properties
            const tasks = dealOpenTasks(deal.id)
            return (
              <tr
                key={deal.id}
                className={deal.id === state.selectedId ? 'ra' : ''}
                onClick={() => selectLead(deal.id)}
              >
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, maxWidth: 200 }}>
                    <span className="tn" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {p.hs_lead_name || '--'}
                    </span>
                    {tasks.length > 0 && <span className="task-badge">{tasks.length}</span>}
                  </div>
                </td>
                <td className="tm">{relTime(p[P.requestedAt])}</td>
                <td style={{ fontSize: 12, color: 'var(--cs)' }}>{p.phone_number || '--'}</td>
                <td>{prodBadge(p[P.product])}</td>
                <td className="tm">{p[P.callOutcome] || '--'}</td>
                <td><span className="badge bg" style={{fontSize:11}}>{stageLabel(p.hs_pipeline_stage)}</span></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Request leads / cooldown row ───────────────────────────────────────────────
function ReqRow({ lang }: { lang: 'nl' | 'en' }) {
  const { state, setState } = useApp()
  const t = (k: string, ...a: any[]) => translate(lang, k, ...a)
  const [secs, setSecs] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const onCD = !!(state.cooldownEnd && Date.now() < state.cooldownEnd)

  useEffect(() => {
    if (onCD) {
      const tick = () => {
        if (!state.cooldownEnd || Date.now() >= state.cooldownEnd) {
          setSecs(0)
          if (timerRef.current) clearInterval(timerRef.current)
          setState({ cooldownEnd: null })
          return
        }
        setSecs(Math.ceil((state.cooldownEnd - Date.now()) / 1000))
      }
      tick()
      timerRef.current = setInterval(tick, 1000)
      return () => { if (timerRef.current) clearInterval(timerRef.current) }
    }
  }, [onCD, state.cooldownEnd, setState])

  async function handleReq() {
    if (onCD || state.loading || !state.currentRep) return
    setState({ loading: true })
    try {
      await requestLeads(state.currentRep)
      const newEnd = Date.now() + CONFIG.REQUEST_COOLDOWN * 1000
      setState({ cooldownEnd: newEnd })
      showToast(t('toastLeads'), 'success')
      setTimeout(async () => {
        try {
          const leads = await fetchLeads(state.currentRep!.hubspotOwnerId)
          setState({ leads })
        } catch {}
      }, 3000)
    } catch (e: any) {
      showToast(t('errWH', e.message), 'error')
    }
    setState({ loading: false })
  }

  return (
    <div className="rr">
      <button
        className="btn btn-pr btn-sm"
        onClick={handleReq}
        disabled={onCD || state.loading}
      >
        {state.loading && <div className="sp" />}
        {onCD ? t('wait', secs) : state.loading ? t('reqding') : t('reqLeads')}
      </button>
      {onCD && (
        <div className="cdp">
          <div className="cdb">
            <div className="cdf" style={{ width: (secs / CONFIG.REQUEST_COOLDOWN * 100) + '%' }} />
          </div>
          <span>{t('nextReq', secs)}</span>
        </div>
      )}
    </div>
  )
}

// ── Main PipelineBoard ────────────────────────────────────────────────────────
interface PipelineBoardProps {
  perfOpen: boolean
  onOpenPerf: () => void
  onClosePerf: () => void
}

export default function PipelineBoard({ perfOpen, onOpenPerf, onClosePerf }: PipelineBoardProps) {
  const { state, setState, selectLead } = useApp()
  const lang = state.lang
  const t = (k: string, ...a: any[]) => translate(lang, k, ...a)
  const openTasks = myOpenTasks(state.currentRep?.email)
  const [tasksVersion, setTasksVersion] = useState(0)

  // ── Background sync: poll HubSpot every 30s (pauses when tab hidden) ────────
  // Catches changes made in HubSpot CRM so they appear in the tool automatically.
  const syncOwnerId = state.currentRep?.hubspotOwnerId || ''
  useEffect(() => {
    if (!syncOwnerId || isDemo()) return
    const POLL_MS = 30_000
    async function poll() {
      if (document.hidden) return // skip when tab not visible
      try {
        const leads = await fetchLeads(syncOwnerId)
        setState(prev => {
          if (leads.length === 0 && prev.leads.length > 0) return {} // safety: don't clear on empty
          const changed =
            leads.length !== prev.leads.length ||
            leads.some(l => {
              const pl = prev.leads.find(p => p.id === l.id)
              return !pl || JSON.stringify(pl.properties) !== JSON.stringify(l.properties)
            })
          return changed ? { leads } : {} // only re-render when data actually changed
        })
      } catch { /* silent — background errors don't toast */ }
    }
    const id = setInterval(poll, POLL_MS)
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncOwnerId])

  // ── Post-write re-fetch: 3s after a successful PATCH, refresh just that lead ─
  // Confirms the write landed and replaces optimistic state with server truth.
  useEffect(() => {
    if (isDemo()) return
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    const unsub = onLeadWrite(leadId => {
      if (timers.has(leadId)) clearTimeout(timers.get(leadId)!)
      timers.set(leadId, setTimeout(async () => {
        timers.delete(leadId)
        const fresh = await fetchOneLead(leadId)
        if (!fresh) return
        setState(prev => {
          // If the lead is no longer in MQL or no longer owned by this rep, remove it
          const stage = fresh.properties?.hs_pipeline_stage
          const owner = fresh.properties?.hubspot_owner_id
          const myOwner = prev.currentRep?.hubspotOwnerId
          if (stage !== CONFIG.STAGES.MQL || (myOwner && owner !== myOwner)) {
            return { leads: prev.leads.filter(l => l.id !== leadId) }
          }
          return { leads: prev.leads.map(l => l.id === leadId ? fresh : l) }
        })
      }, 3000))
    })
    return () => { unsub(); timers.forEach(t => clearTimeout(t)) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync tasks from HubSpot on login
  useEffect(() => {
    if (!syncOwnerId || isDemo()) return
    fetchHsTasks(syncOwnerId).then(hsTasks => {
      if (!hsTasks.length) return
      // Convert HsTask → Task and merge into localStorage
      // (keep any local-only tasks that don't have a HubSpot ID yet)
      const existing = loadTasks()
      const hsIds = new Set(hsTasks.map(t => t.hsId))
      const localOnly = existing.filter(t => !t.hsTaskId || !hsIds.has(t.hsTaskId))
      const merged = [
        ...hsTasks.map(t => ({
          id: t.hsId,
          hsTaskId: t.hsId,
          dealId: t.leadId,
          assigneeEmail: state.currentRep?.email || '',
          creatorEmail: state.currentRep?.email || '',
          title: t.title,
          note: t.notes,
          dueDate: t.dueDate,
          completed: false,
          completedAt: null,
          createdAt: '',
        })),
        ...localOnly,
      ]
      saveTasks(merged)
      setTasksVersion(v => v + 1)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncOwnerId])

  async function handleRefresh() {
    setState({ loading: true })
    try {
      const leads = await fetchLeads(state.currentRep?.hubspotOwnerId || '')
      setState({ leads, loading: false })
      showToast(t('toastRefreshed'), 'success')
    } catch (e: any) {
      showToast(t('errLoad', e.message), 'error')
      setState({ loading: false })
    }
  }

  function openCreateTask() {
    setState({
      taskModal: 'create',
      taskDraft: { dealId: null, assigneeEmail: state.currentRep?.email || '', title: '', dueDate: '', note: '' },
    })
  }

  return (
    <div className="ml">
      <div className="la">
        {/* Tab bar */}
        <div className="tab-bar">
          <button
            className={`tab-btn ${state.taskTab === 'leads' ? 'on' : ''}`}
            onClick={() => setState({ taskTab: 'leads' })}
          >
            {t('taskTabLeads')}
            <span className={`tab-count ${state.leads.length ? 'has' : ''}`}>{state.leads.length}</span>
          </button>
          <button
            className={`tab-btn ${state.taskTab === 'tasks' ? 'on' : ''}`}
            onClick={() => setState({ taskTab: 'tasks' })}
          >
            {t('taskTabTasks')}
            <span className={`tab-count ${openTasks.length ? 'has' : ''}`}>{openTasks.length}</span>
          </button>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
            {state.taskTab === 'leads' && (
              <>
                <ReqRow lang={lang} />
                <button className="btn btn-sc btn-sm" onClick={handleRefresh}>{t('refresh')}</button>
              </>
            )}
            {state.taskTab === 'tasks' && (
              <button className="btn btn-pr btn-sm" onClick={openCreateTask}>{t('taskNew')}</button>
            )}
          </div>
        </div>

        {/* Tab content */}
        {state.taskTab === 'leads'
          ? (state.loading && !state.leads.length
            ? <div className="es"><div className="sp spd" /></div>
            : <DealsTable lang={lang} />)
          : <TasksTab lang={lang} />
        }
      </div>

      {/* Deal modal */}
      {state.selectedId && <DealModal />}

      {/* Task create modal */}
      {state.taskModal === 'create' && <CreateTaskModal lang={lang} />}

      {/* Performance drawer */}
      {perfOpen && <PerfDrawer lang={lang} />}
    </div>
  )
}
