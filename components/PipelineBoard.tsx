'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useApp } from '@/context/AppContext'
import { translate, translateArr } from '@/lib/i18n'
import { CONFIG, stageLabel, isDemo } from '@/lib/config'
import { requestLeads, fetchLeads, fetchPerformance, fetchOneLead, onLeadWrite, createHsTask, fetchHsTasks, completeHsTask, deleteHsTask, fetchOwnersByTeams, fetchTasksForLeads } from '@/lib/hubspot'
import type { HsTask, TeamOwner } from '@/lib/hubspot'
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
  const [owners, setOwners] = useState<TeamOwner[]>([])

  // Load the assignable HubSpot owners once when the modal opens
  useEffect(() => {
    // Both Sales Support and Technical Sales Calls work in this tool, so both
    // teams must be assignable. Scoped to those two rather than the whole
    // portal: an unscoped list pulls in people who never touch these leads.
    fetchOwnersByTeams(CONFIG.TASK_ASSIGNEE_TEAMS.map(tm => tm.id)).then(list => {
      setOwners(list)
      // Pre-select current rep if not already set
      if (!draft.assigneeOwnerId && state.currentRep?.hubspotOwnerId) {
        setState({ taskDraft: { ...state.taskDraft, assigneeOwnerId: state.currentRep.hubspotOwnerId } })
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The combined list is long, so it is grouped by team rather than shown as
  // one flat run of names. Current rep is pinned above the groups — reps assign
  // to themselves most of the time — and is not repeated inside them. Anyone in
  // both teams is listed under the first team they match, so no one appears
  // twice; anyone whose team came back empty falls into a trailing group rather
  // than silently disappearing from the picker.
  const meId = state.currentRep?.hubspotOwnerId
  const me = owners.find(o => o.id === meId)
  const claimed = new Set<string>(me ? [me.id] : [])
  const groups = CONFIG.TASK_ASSIGNEE_TEAMS.map(tm => {
    const members = owners.filter(o => !claimed.has(o.id) && o.teamIds.includes(tm.id))
    members.forEach(o => claimed.add(o.id))
    return { label: tm.label, members }
  }).filter(g => g.members.length > 0)
  const ungrouped = owners.filter(o => !claimed.has(o.id))
  if (ungrouped.length) groups.push({ label: t('taskAssignOther'), members: ungrouped })

  async function submit() {
    if (!draft.title?.trim()) { showToast(t('taskTitle') + ' is required', 'error'); return }
    // Without a lead the task cannot appear in the Tasks tab at all, so block
    // it here rather than let the rep create something they will never see.
    if (!draft.dealId) { showToast(t('taskLeadRequired'), 'error', 6000); return }
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
              {/* The current rep is always offered, even when they are not in
                  one of the assignee teams — the draft pre-selects their owner
                  id, and without a matching option the select renders blank. */}
              {meId
                ? <option value={meId}>{me?.name || state.currentRep?.name || '…'} ({t('taskAssignMe')})</option>
                : owners.length === 0 && <option value="">{state.currentRep?.name || '…'}</option>}
              {groups.map(g => (
                <optgroup key={g.label} label={g.label}>
                  {g.members.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          {/* Lead link is required: the Tasks tab only shows tasks associated
              with the rep's MQL leads, so an unlinked task would be invisible
              in the tool. Locked when the task was started from a lead, since
              there is nothing to choose. */}
          <div className="iw">
            <label className="il">{t('taskDeal')} <span style={{ color: 'var(--rd)' }}>*</span></label>
            {linkedLead ? (
              <div style={{ fontSize: 13, color: 'var(--ct)', padding: '4px 0' }}>📋 {linkedLead.properties?.hs_lead_name || '--'}</div>
            ) : state.leads.length === 0 ? (
              // No leads to pick from — say so plainly rather than showing an
              // empty dropdown the rep cannot satisfy.
              <div style={{ fontSize: 12, color: 'var(--cs)', padding: '4px 0' }}>{t('taskNoLeads')}</div>
            ) : (
              <select
                className="sel"
                value={draft.dealId || ''}
                onChange={e => setState({ taskDraft: { ...state.taskDraft, dealId: e.target.value } })}
              >
                <option value="">{t('taskPickLead')}</option>
                {state.leads.map(l => (
                  <option key={l.id} value={l.id}>{l.properties?.hs_lead_name || l.id}</option>
                ))}
              </select>
            )}
          </div>
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

type SortKey = 'title' | 'status' | 'due' | 'lead'

// ── Tasks tab ─────────────────────────────────────────────────────────────────
// Reads tasks from HubSpot rather than localStorage. The old local list only
// showed tasks created in this tool on this device, so a rep on another laptop
// saw nothing and tasks made directly in HubSpot never appeared. Scoped to the
// rep's MQL leads, which is what keeps it to two API calls.
function TasksTab({ lang }: { lang: 'nl' | 'en' }) {
  const { state, selectLead } = useApp()
  const t = (k: string, ...a: any[]) => translate(lang, k, ...a)

  const [tasks, setTasks] = useState<HsTask[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('due')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  // Keyed on the lead ids so it reloads whenever the board's leads change.
  const leadIdsKey = state.leads.map(l => l.id).join(',')

  const load = useCallback(async () => {
    const ids = state.leads.map(l => l.id)
    if (ids.length === 0) { setTasks([]); setLoading(false); return }
    setLoading(true)
    try {
      setTasks(await fetchTasksForLeads(state.currentRep?.hubspotOwnerId || '', ids))
    } finally {
      setLoading(false)
    }
  }, [leadIdsKey, state.currentRep?.hubspotOwnerId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  function dueMeta(dueAt: string | undefined): { label: string; cls: string } {
    if (!dueAt) return { label: t('taskNoDate'), cls: '' }
    const d = new Date(dueAt), now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const due = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    const diff = Math.round((due.getTime() - today.getTime()) / 86400000)
    // Time matters for call-backs — a rep who agreed 10:00 needs to see 10:00,
    // so it is always shown alongside the day.
    const time = d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
    if (diff < 0)  return { label: `${t('taskOverdue')} · ${d.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short' })} ${time}`, cls: 'task-due-over' }
    if (diff === 0) return { label: `${t('taskToday')} · ${time}`, cls: 'task-due-today' }
    if (diff === 1) return { label: `${t('taskTomorrow')} · ${time}`, cls: 'task-due-ok' }
    return { label: `${d.toLocaleDateString('nl-NL', { weekday: 'short', day: '2-digit', month: 'short' })} ${time}`, cls: 'task-due-ok' }
  }

  const footer = (
    <div className="es2" style={{ marginTop: 12, textAlign: 'center' }}>
      {t('taskMqlOnly')}{' '}
      {/* The second sentence ends in the link ("...by clicking here"), so it is
          only rendered when there is a link to end it with — without the portal
          id it would trail off mid-sentence. */}
      {state.hubspotPortalId && (
        <>
          {t('taskOtherInHs')}{' '}
          <a href={`https://app-eu1.hubspot.com/tasks/${state.hubspotPortalId}/view/all`}
             target="_blank" rel="noreferrer">{t('taskAllInHs')}</a>
        </>
      )}
    </div>
  )

  if (loading) {
    return <div className="es"><div className="et">{t('taskLoading')}</div></div>
  }

  if (!tasks.length) {
    return (
      <div className="es">
        <div className="ei">✅</div>
        <div className="et">{t('taskNone')}</div>
        <div className="es2">{t('taskNoneSub')}</div>
        {footer}
      </div>
    )
  }

  // Sorting is client-side over the already-fetched list — no extra API calls.
  const sorted = [...tasks].sort((a, b) => {
    let r = 0
    switch (sortKey) {
      case 'title':  r = (a.title || '').localeCompare(b.title || ''); break
      case 'status': r = (a.status || '').localeCompare(b.status || ''); break
      case 'lead': {
        const an = state.leads.find(l => l.id === a.leadId)?.properties?.hs_lead_name || ''
        const bn = state.leads.find(l => l.id === b.leadId)?.properties?.hs_lead_name || ''
        r = an.localeCompare(bn); break
      }
      default: {
        // Undated tasks always sort last, whichever direction is active —
        // otherwise flipping the arrow buries the urgent ones.
        if (!a.dueAt && !b.dueAt) return 0
        if (!a.dueAt) return 1
        if (!b.dueAt) return -1
        r = new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
      }
    }
    return sortDir === 'asc' ? r : -r
  })

  // translate() echoes the key back when it is missing, which would surface as
  // "taskStatus_WHATEVER" if HubSpot adds a status we don't have a label for.
  function statusLabel(status: string | undefined): string {
    if (!status) return '--'
    const label = t('taskStatus_' + status)
    return label === 'taskStatus_' + status ? status : label
  }

  function SortTh({ k, label }: { k: SortKey; label: string }) {
    const active = sortKey === k
    return (
      <th
        style={{ cursor: 'pointer', userSelect: 'none' }}
        onClick={() => {
          if (active) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
          else { setSortKey(k); setSortDir('asc') }
        }}
      >
        {label}{active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
      </th>
    )
  }

  return (
    <>
      <div className="fade-up" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <table>
          <thead>
            <tr>
              <SortTh k="title"  label={t('thTaskTitle')} />
              <SortTh k="status" label={t('thTaskStatus')} />
              <SortTh k="due"    label={t('thTaskDue')} />
              <th>{t('thTaskNotes')}</th>
              <SortTh k="lead"   label={t('thTaskLead')} />
              <th>{t('thTaskHs')}</th>
              <th>{t('thTaskActions')}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(task => {
              const dm = dueMeta(task.dueAt)
              const lead = state.leads.find(l => l.id === task.leadId)
              return (
                <tr key={task.hsId} style={{ cursor: 'default' }}>
                  <td className="tn" title={task.title}>{task.title || '--'}</td>
                  <td className="tm">{statusLabel(task.status)}</td>
                  <td><span className={`task-card-due ${dm.cls}`}>{dm.label}</span></td>
                  <td className="tm" style={{ maxWidth: 260, whiteSpace: 'normal' }}>{task.notes || '--'}</td>
                  <td>
                    {lead ? (
                      <span
                        style={{ cursor: 'pointer', color: 'var(--gr)', fontWeight: 600 }}
                        onClick={() => selectLead(lead.id)}
                      >{lead.properties?.hs_lead_name || '--'}</span>
                    ) : <span className="tm">--</span>}
                  </td>
                  <td>
                    {state.hubspotPortalId ? (
                      <a href={`https://app-eu1.hubspot.com/contacts/${state.hubspotPortalId}/record/0-27/${task.hsId}`}
                         target="_blank" rel="noreferrer">{t('taskOpenHs')}</a>
                    ) : <span className="tm">--</span>}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, whiteSpace: 'nowrap' }}>
                      <button className="btn btn-gn btn-xs" disabled={busyId === task.hsId} onClick={async () => {
                        setBusyId(task.hsId); await completeHsTask(task.hsId); await load(); setBusyId(null)
                      }}>{t('taskDone')}</button>
                      <button className="btn btn-dn btn-xs" disabled={busyId === task.hsId} onClick={async () => {
                        setBusyId(task.hsId); await deleteHsTask(task.hsId); await load(); setBusyId(null)
                      }}>{t('taskDelete')}</button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {footer}
    </>
  )
}

// ── Deals table ───────────────────────────────────────────────────────────────
function DealsTable({ lang }: { lang: 'nl' | 'en' }) {
  const { state, selectLead } = useApp()
  const t = (k: string, ...a: any[]) => translate(lang, k, ...a)
  const P = CONFIG.PROPS

  const [filterProduct, setFilterProduct] = useState<string>('')
  const [filterOutcome, setFilterOutcome] = useState<string>('')
  const [sortCol, setSortCol] = useState<'time' | 'product' | 'outcome' | ''>('')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [openFilter, setOpenFilter] = useState<'product' | 'outcome' | null>(null)
  const filterRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!openFilter) return
    function onClickOutside(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setOpenFilter(null)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [openFilter])

  if (!state.leads.length) {
    return (
      <div className="es">
        <div className="ei">📋</div>
        <div className="et">{t('noLeads')}</div>
        <div className="es2">{t('noLeadsSub')}</div>
      </div>
    )
  }

  // Unique values for filter dropdowns
  const products = Array.from(new Set(state.leads.map(l => l.properties[P.product] || '').filter(Boolean))).sort()
  const outcomes = Array.from(new Set(state.leads.map(l => l.properties[P.callOutcome] || '').filter(Boolean))).sort()

  function toggleSort(col: typeof sortCol) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  function sortIcon(col: typeof sortCol) {
    if (sortCol !== col) return ' ↕'
    return sortDir === 'asc' ? ' ↑' : ' ↓'
  }

  let leads = [...state.leads]
  if (filterProduct) leads = leads.filter(l => l.properties[P.product] === filterProduct)
  if (filterOutcome) leads = leads.filter(l => l.properties[P.callOutcome] === filterOutcome)
  if (sortCol === 'time') leads.sort((a, b) => {
    const av = new Date(a.properties[P.requestedAt] || 0).getTime()
    const bv = new Date(b.properties[P.requestedAt] || 0).getTime()
    return sortDir === 'asc' ? av - bv : bv - av
  })
  if (sortCol === 'product') leads.sort((a, b) => {
    const av = a.properties[P.product] || ''
    const bv = b.properties[P.product] || ''
    return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
  })
  if (sortCol === 'outcome') leads.sort((a, b) => {
    const av = a.properties[P.callOutcome] || ''
    const bv = b.properties[P.callOutcome] || ''
    return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
  })

  const filterDropStyle: React.CSSProperties = {
    position: 'absolute', top: '100%', left: 0, zIndex: 200,
    background: 'var(--bg)', border: '1px solid var(--gl)',
    borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,.18)',
    minWidth: 160, padding: '4px 0', marginTop: 2,
  }
  const filterItemStyle = (active: boolean): React.CSSProperties => ({
    display: 'block', width: '100%', textAlign: 'left',
    padding: '5px 12px', fontSize: 12, border: 'none',
    background: active ? 'var(--cp)' : 'transparent',
    color: active ? '#fff' : 'var(--tx)', cursor: 'pointer',
  })

  function FilterTh({ col, label, value, values, onSet, sortable }: {
    col: 'product' | 'outcome', label: string, value: string,
    values: string[], onSet: (v: string) => void, sortable?: boolean
  }) {
    const isOpen = openFilter === col
    const hasFilter = !!value
    return (
      <th style={{ position: 'relative', whiteSpace: 'nowrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {sortable
            ? <span style={{ cursor: 'pointer', flex: 1 }} onClick={() => toggleSort(col)}>{label}{sortIcon(col)}</span>
            : <span style={{ flex: 1 }}>{label}</span>
          }
          <button
            onClick={e => { e.stopPropagation(); setOpenFilter(isOpen ? null : col) }}
            title="Filter"
            style={{
              border: 'none', background: 'none', cursor: 'pointer', padding: '0 2px',
              color: hasFilter ? 'var(--cp)' : 'var(--cs)', fontSize: 11, lineHeight: 1,
            }}
          >{hasFilter ? '▼' : '▽'}</button>
        </div>
        {isOpen && (
          <div ref={filterRef} style={filterDropStyle} onClick={e => e.stopPropagation()}>
            <button style={filterItemStyle(!value)} onClick={() => { onSet(''); setOpenFilter(null) }}>
              {t('filterClear')} (all)
            </button>
            {values.map(v => (
              <button key={v} style={filterItemStyle(value === v)} onClick={() => { onSet(v); setOpenFilter(null) }}>
                {v}
              </button>
            ))}
          </div>
        )}
      </th>
    )
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      <table>
        <thead>
          <tr>
            <th>
              {t('colName')}
              {(filterProduct || filterOutcome) && (
                <span
                  onClick={() => { setFilterProduct(''); setFilterOutcome('') }}
                  title={t('filterClear')}
                  style={{ marginLeft: 6, cursor: 'pointer', color: 'var(--cp)', fontSize: 10 }}
                >✕</span>
              )}
              <span style={{ float: 'right', fontSize: 10, color: 'var(--cs)', fontWeight: 400 }}>
                {leads.length}/{state.leads.length}
              </span>
            </th>
            <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('time')}>{t('colTime')}{sortIcon('time')}</th>
            <th>{t('colPhone')}</th>
            <FilterTh col="product" label={t('colProduct')} value={filterProduct} values={products} onSet={setFilterProduct} sortable />
            <FilterTh col="outcome" label={t('colOutcome')} value={filterOutcome} values={outcomes} onSet={setFilterOutcome} sortable />
            <th>Stage</th>
          </tr>
        </thead>
        <tbody>
          {leads.map(deal => {
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
