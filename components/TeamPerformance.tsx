'use client'

// Admin → Team performance: the reps' own Performance numbers, for the whole
// "Sales Support Team (Dennis)" and per member, plus time to process, open tasks
// and active time. Admin-only (the API enforces it too). Definitions: lib/teamPerf.ts.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { translate } from '@/lib/i18n'
import { fetchTeamOverview, fetchTeamWeek, fetchTeamActivity } from '@/lib/storage'
import {
  HISTORY_START, MAX_MONTHS_BACK, amsDay, dayAdd, weekStartOf, monthAdd, weeksCovering, daysBetween,
  sumRange, mean, median,
  type TeamOverview, type TeamPerfWeek, type ActivityData, type PerfTotals,
} from '@/lib/teamPerf'

type Lang = 'nl' | 'en'
type Period = 'today' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth' | 'last3m' | 'last6m' | 'custom'
const PERIODS: Period[] = ['today', 'thisWeek', 'lastWeek', 'thisMonth', 'lastMonth', 'last3m', 'last6m', 'custom']

// Stack order bottom → top; colors validated for both themes (app/globals.css --tp-*)
const OUTCOMES = [
  { key: 'sql', label: 'tpSQL', color: 'var(--tp-sql)' },
  { key: 'lto', label: 'tpLTO', color: 'var(--tp-lto)' },
  { key: 'lost', label: 'tpLost', color: 'var(--tp-lost)' },
  { key: 'other', label: 'tpOther', color: 'var(--tp-other)' },
] as const

/** Refresh recomputes weeks this recent; older weeks follow the server's cache. */
const REFRESH_DAYS = 35
/** Ranges up to this many days chart per day; longer ranges per week. */
const DAILY_MAX = 35

type SortKey = 'name' | 'p' | 'sql' | 'lto' | 'lost' | 'time' | 'open' | 'done' | 'active'

// ── Formatting ────────────────────────────────────────────────────────────────
const locale = (lang: Lang) => (lang === 'nl' ? 'nl-NL' : 'en-GB')
const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0)
const fmtNum = (n: number, lang: Lang) => n.toLocaleString(locale(lang))

function fmtDur(min: number | null, lang: Lang): string {
  if (min === null || !Number.isFinite(min)) return '–'
  const m = Math.round(min)
  if (m < 60) return `${m} m`
  return `${Math.floor(m / 60)}${lang === 'nl' ? 'u' : 'h'} ${String(m % 60).padStart(2, '0')}m`
}

function fmtDay(day: string, lang: Lang, opts: Intl.DateTimeFormatOptions): string {
  return new Date(day + 'T12:00:00Z').toLocaleDateString(locale(lang), { timeZone: 'UTC', ...opts })
}

/** ISO week number of the week starting on Monday `monday`. */
function isoWeek(monday: string): number {
  const thu = dayAdd(monday, 3)
  const jan1 = thu.slice(0, 4) + '-01-01'
  const dayOfYear = Math.round((Date.parse(thu) - Date.parse(jan1)) / 86400000)
  return Math.floor(dayOfYear / 7) + 1
}

function periodRange(p: Period, today: string, custom: { from: string; to: string }): { from: string; to: string } {
  const monthStart = today.slice(0, 8) + '01'
  switch (p) {
    case 'today': return { from: today, to: today }
    case 'thisWeek': return { from: weekStartOf(today), to: today }
    case 'lastWeek': { const w = dayAdd(weekStartOf(today), -7); return { from: w, to: dayAdd(w, 6) } }
    case 'thisMonth': return { from: monthStart, to: today }
    case 'lastMonth': return { from: monthAdd(monthStart, -1), to: dayAdd(monthStart, -1) }
    case 'last3m': return { from: dayAdd(monthAdd(today, -3), 1), to: today }
    case 'last6m': return { from: dayAdd(monthAdd(today, -MAX_MONTHS_BACK), 1), to: today }
    case 'custom': return custom
  }
}

interface ActSums { minutes: number; personDays: number; byOwner: Record<string, { minutes: number; days: number }>; byDay: Record<string, { minutes: number; people: number }> }

function sumActivity(activity: ActivityData | null, emailToOwner: Map<string, string>, owners: Set<string>, from: string, to: string): ActSums {
  const out: ActSums = { minutes: 0, personDays: 0, byOwner: {}, byDay: {} }
  if (!activity) return out
  for (const [day, perEmail] of Object.entries(activity.days)) {
    if (day < from || day > to) continue
    for (const [email, minutes] of Object.entries(perEmail)) {
      const ownerId = emailToOwner.get(email.toLowerCase())
      if (!ownerId || !owners.has(ownerId) || !(minutes > 0)) continue
      out.minutes += minutes
      out.personDays++
      const o = out.byOwner[ownerId] || (out.byOwner[ownerId] = { minutes: 0, days: 0 })
      o.minutes += minutes; o.days++
      const d = out.byDay[day] || (out.byDay[day] = { minutes: 0, people: 0 })
      d.minutes += minutes; d.people++
    }
  }
  return out
}

// ── Main tab ──────────────────────────────────────────────────────────────────
export default function TeamPerformance({ lang }: { lang: Lang }) {
  const t = (k: string, ...a: any[]) => translate(lang, k, ...a)
  const today = amsDay(Date.now())
  const minDay = dayAdd(monthAdd(today, -MAX_MONTHS_BACK), 1)

  const [period, setPeriod] = useState<Period>('thisMonth')
  const [custom, setCustom] = useState({ from: weekStartOf(today), to: today })
  const [selected, setSelected] = useState<string | null>(null)
  const [overview, setOverview] = useState<TeamOverview | null>(null)
  const [overviewErr, setOverviewErr] = useState<string | null>(null)
  const [weeks, setWeeks] = useState<Record<string, TeamPerfWeek>>({})
  const [failedWeeks, setFailedWeeks] = useState<Record<string, string>>({})
  const [activity, setActivity] = useState<ActivityData | null>(null)
  const [activityErr, setActivityErr] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'p', dir: -1 })
  const weeksRef = useRef(weeks)
  weeksRef.current = weeks
  const inflight = useRef(new Set<string>())
  const activityReq = useRef(0)

  const range = periodRange(period, today, custom)
  const dataFrom = range.from < HISTORY_START ? HISTORY_START : range.from
  const neededWeeks = useMemo(
    () => (dataFrom <= range.to ? weeksCovering(dataFrom, range.to).reverse() : []), // newest first
    [dataFrom, range.to],
  )

  async function loadOverview(force = false) {
    setOverviewErr(null)
    try { setOverview(await fetchTeamOverview(force)) }
    catch (e: any) { setOverviewErr(e?.message || String(e)) }
  }

  async function loadWeeks(list: string[], force: boolean) {
    const todo = list.filter(w => !inflight.current.has(w) && (force || !weeksRef.current[w]))
    if (!todo.length) return
    todo.forEach(w => inflight.current.add(w))
    setFailedWeeks(prev => { const n = { ...prev }; todo.forEach(w => delete n[w]); return n })
    const queue = [...todo]
    // Two at a time: HubSpot's search rate limit is shared with the reps' boards
    const worker = async () => {
      for (let w = queue.shift(); w; w = queue.shift()) {
        const week = w
        try {
          const data = await fetchTeamWeek(week, force)
          setWeeks(prev => ({ ...prev, [week]: data }))
        } catch (e: any) {
          setFailedWeeks(prev => ({ ...prev, [week]: e?.message || String(e) }))
        } finally {
          inflight.current.delete(week)
        }
      }
    }
    await Promise.all([worker(), worker()])
  }

  async function loadActivity(from: string, to: string) {
    const id = ++activityReq.current
    setActivityErr(null)
    try {
      const a = await fetchTeamActivity(from, to)
      if (id === activityReq.current) setActivity(a)
    } catch (e: any) {
      if (id === activityReq.current) { setActivity(null); setActivityErr(e?.message || String(e)) }
    }
  }

  async function refresh() {
    if (refreshing) return
    setRefreshing(true)
    const recent = dayAdd(today, -REFRESH_DAYS)
    await Promise.all([
      loadOverview(true),
      loadWeeks(neededWeeks.filter(w => dayAdd(w, 6) >= recent), true),
      loadActivity(range.from, range.to),
    ])
    setRefreshing(false)
  }

  useEffect(() => { loadOverview() }, [])

  // Weeks wait for the overview, so a cold start looks the team up in HubSpot once, not three times
  useEffect(() => {
    if (overview) loadWeeks(neededWeeks, false)
  }, [overview !== null, neededWeeks.join()])

  useEffect(() => { loadActivity(range.from, range.to) }, [range.from, range.to])

  const members = overview?.members ?? []
  useEffect(() => {
    if (selected && overview && !members.some(m => m.ownerId === selected)) setSelected(null)
  }, [overview])

  // ── Derived numbers ──
  const allIds = useMemo(() => members.map(m => m.ownerId), [overview])
  const emailToOwner = useMemo(() => new Map(members.map(m => [m.email.toLowerCase(), m.ownerId])), [overview])
  const weekList = useMemo(() => Object.values(weeks), [weeks])
  const scopeIds = selected ? [selected] : allIds
  const teamSums = useMemo(() => sumRange(weekList, range.from, range.to, allIds), [weekList, range.from, range.to, allIds])
  const scope = useMemo(
    () => (selected ? sumRange(weekList, range.from, range.to, [selected]) : teamSums),
    [selected, teamSums, weekList, range.from, range.to],
  )
  const teamAct = useMemo(() => sumActivity(activity, emailToOwner, new Set(allIds), range.from, range.to), [activity, emailToOwner, allIds, range.from, range.to])
  const scopeAct = useMemo(
    () => (selected ? sumActivity(activity, emailToOwner, new Set([selected]), range.from, range.to) : teamAct),
    [selected, teamAct, activity, emailToOwner, range.from, range.to],
  )

  const pending = neededWeeks.filter(w => !weeks[w] && !failedWeeks[w])
  const failed = neededWeeks.filter(w => failedWeeks[w])
  const busy = pending.length > 0 || refreshing
  const loadedNeeded = neededWeeks.filter(w => weeks[w])
  const recent = dayAdd(today, -REFRESH_DAYS)
  const stamps = (loadedNeeded.some(w => dayAdd(w, 6) >= recent) ? loadedNeeded.filter(w => dayAdd(w, 6) >= recent) : loadedNeeded)
    .map(w => weeks[w].computedAt)
  const updatedAt = stamps.length ? Math.min(...stamps) : overview?.computedAt ?? null

  // ── Loading / error states ──
  if (!overview) {
    return (
      <div className="tp">
        {overviewErr
          ? <div className="tp-note">{t('tpErr', overviewErr)} <button className="btn btn-sc btn-xs" onClick={() => loadOverview()}>{t('tpRetry')}</button></div>
          : <div className="tp-loadbar"><div className="sp spd" /> {t('tpLoading')}</div>}
      </div>
    )
  }
  if (members.length === 0) {
    return <div className="tp"><div className="tp-note">{t('tpNoMembers')}</div></div>
  }

  const tot = scope.total
  const open = scopeIds.reduce((a, id) => {
    const o = overview.openTasks[id]
    return { open: a.open + (o?.open || 0), overdue: a.overdue + (o?.overdue || 0) }
  }, { open: 0, overdue: 0 })
  const activeAvg = scopeAct.personDays ? scopeAct.minutes / scopeAct.personDays : null
  const selectedMember = members.find(m => m.ownerId === selected) || null

  // ── Chart data ── (from the first day with data: no empty bars before the pipeline existed)
  const chartFrom = dataFrom <= range.to ? dataFrom : range.from
  const days = daysBetween(chartFrom, range.to)
  const daily = days.length <= DAILY_MAX
  const buckets = daily
    ? days.map(d => ({ key: d, label: fmtDay(d, lang, { day: 'numeric', month: 'short' }), title: fmtDay(d, lang, { weekday: 'short', day: 'numeric', month: 'short' }), days: [d] }))
    : weeksCovering(chartFrom, range.to).map(w => ({
        key: w,
        label: `wk ${isoWeek(w)}`,
        title: t('tpWeekOf', fmtDay(w, lang, { day: 'numeric', month: 'short' })),
        days: daysBetween(w < chartFrom ? chartFrom : w, dayAdd(w, 6) > range.to ? range.to : dayAdd(w, 6)),
      }))
  const leadBars: BarDatum[] = buckets.map(b => {
    const v = { sql: 0, lto: 0, lost: 0, other: 0 }
    for (const d of b.days) {
      const s = scope.byDay[d]
      if (s) { v.sql += s.sql; v.lto += s.lto; v.lost += s.lost; v.other += s.other }
    }
    return { key: b.key, label: b.label, title: b.title, values: OUTCOMES.map(o => v[o.key]) }
  })
  const activeBars: BarDatum[] = buckets.map(b => {
    let minutes = 0, people = 0
    for (const d of b.days) { const a = scopeAct.byDay[d]; if (a) { minutes += a.minutes; people += a.people } }
    return { key: b.key, label: b.label, title: b.title, values: [people ? minutes / people : 0] }
  })
  const outcomeSeries = OUTCOMES.map(o => ({ label: t(o.label), color: o.color }))

  // ── Member table ──
  const rows = members.map(m => {
    const s: PerfTotals = teamSums.byOwner[m.ownerId]
    const a = teamAct.byOwner[m.ownerId]
    return {
      m, s,
      time: mean(s.t),
      open: overview.openTasks[m.ownerId]?.open ?? 0,
      overdue: overview.openTasks[m.ownerId]?.overdue ?? 0,
      active: a?.days ? a.minutes / a.days : null,
    }
  })
  const sortVal = (r: typeof rows[number]): number | string | null => {
    switch (sort.key) {
      case 'name': return r.m.name.toLowerCase()
      case 'p': return r.s.p
      case 'sql': return r.s.sql
      case 'lto': return r.s.lto
      case 'lost': return r.s.lost
      case 'time': return r.time
      case 'open': return r.open
      case 'done': return r.s.tc
      case 'active': return r.active
    }
  }
  rows.sort((a, b) => {
    const x = sortVal(a), y = sortVal(b)
    if (x === null && y === null) return 0
    if (x === null) return 1 // empty values last, whatever the direction
    if (y === null) return -1
    return (x < y ? -1 : x > y ? 1 : 0) * sort.dir
  })
  const sortBy = (key: SortKey) => setSort(s => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === 'name' ? 1 : -1 }))
  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : '')

  const activeSub = !activity
    ? (activityErr ? t('tpErr', activityErr) : t('tpLoading'))
    : !activity.configured ? t('tpActiveNotConfigured')
    : !scopeAct.personDays ? t('tpActiveNoData')
    : selected ? t('tpActiveDays', scopeAct.personDays) : t('tpActiveDaysTeam', scopeAct.personDays)
  const since = activity?.since ? fmtDay(activity.since, lang, { day: 'numeric', month: 'long', year: 'numeric' }) : t('tpActiveSinceUnknown')

  return (
    <div className="tp">
      {/* Filters: period first, then who — they scope everything below */}
      <div className="tp-filters">
        {PERIODS.map(p => (
          <button key={p} className={`chip ${period === p ? 'on' : ''}`} onClick={() => setPeriod(p)}>{t('tp_' + p)}</button>
        ))}
        {period === 'custom' && (
          <>
            <span className="tp-note">{t('tpFrom')}</span>
            <input type="date" className="inp" min={minDay} max={custom.to} value={custom.from}
              onChange={e => e.target.value && setCustom(c => ({ ...c, from: e.target.value < minDay ? minDay : e.target.value }))} />
            <span className="tp-note">{t('tpTo')}</span>
            <input type="date" className="inp" min={custom.from} max={today} value={custom.to}
              onChange={e => e.target.value && setCustom(c => ({ ...c, to: e.target.value > today ? today : e.target.value }))} />
          </>
        )}
        <select className="inp" value={selected ?? ''} onChange={e => setSelected(e.target.value || null)} aria-label={t('tpColName')}>
          <option value="">{t('tpWholeTeam')} ({members.length})</option>
          {members.map(m => <option key={m.ownerId} value={m.ownerId}>{m.name}</option>)}
        </select>
        <div className="tp-meta">
          {updatedAt && <span>{t('tpUpdated', new Date(updatedAt).toLocaleTimeString(locale(lang), { hour: '2-digit', minute: '2-digit' }))}</span>}
          <button className="btn btn-sc btn-xs" onClick={refresh} disabled={refreshing}>{t('tpRefresh')}</button>
        </div>
      </div>

      <div className="tp-head">
        <h2>{selectedMember ? selectedMember.name : t('tpWholeTeam')}</h2>
        <span className="tp-note">
          {fmtDay(range.from, lang, { day: 'numeric', month: 'short', year: 'numeric' })}
          {range.to !== range.from && ` – ${fmtDay(range.to, lang, { day: 'numeric', month: 'short', year: 'numeric' })}`}
        </span>
        {selectedMember && <button className="tp-link" onClick={() => setSelected(null)}>{t('tpBackToTeam')}</button>}
      </div>

      {range.from < HISTORY_START && (
        <div className="tp-note">{t('tpDataFrom', fmtDay(HISTORY_START, lang, { day: 'numeric', month: 'long', year: 'numeric' }))}</div>
      )}
      {pending.length > 0 && (
        <div className="tp-loadbar"><div className="sp spd" /> {t('tpLoadingWeeks', neededWeeks.length - pending.length - failed.length, neededWeeks.length)}</div>
      )}
      {failed.length > 0 && (
        <div className="tp-note" style={{ color: 'var(--rd)' }}>
          {t('tpErr', failedWeeks[failed[0]])}{' '}
          <button className="btn btn-sc btn-xs" onClick={() => loadWeeks(failed, false)}>{t('tpRetry')}</button>
        </div>
      )}

      <div className={busy ? 'tp-dim' : ''} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="tp-kpis">
          <Kpi label={t('tpProcessed')} value={fmtNum(tot.p, lang)} />
          <Kpi label={t('tpSQL')} swatch="var(--tp-sql)" value={fmtNum(tot.sql, lang)} sub={t('tpOfProcessed', pct(tot.sql, tot.p))} />
          <Kpi label={t('tpLTO')} swatch="var(--tp-lto)" value={fmtNum(tot.lto, lang)} sub={t('tpOfProcessed', pct(tot.lto, tot.p))} />
          <Kpi label={t('tpLost')} swatch="var(--tp-lost)" value={fmtNum(tot.lost, lang)} sub={t('tpOfProcessed', pct(tot.lost, tot.p))} />
          <Kpi label={t('tpAvgTime')} value={fmtDur(mean(tot.t), lang)} sub={tot.t.length ? t('tpMedianWork', fmtDur(median(tot.t), lang)) : undefined} />
          <Kpi label={t('tpOpenTasks')} value={fmtNum(open.open, lang)} sub={t('tpOverdue', open.overdue)} />
          <Kpi label={t('tpTasksDone')} value={fmtNum(tot.tc, lang)} />
          <Kpi label={t('tpActivePerDay')} value={fmtDur(activeAvg, lang)} sub={activeSub} />
        </div>

        <div className="tp-charts">
          <ChartCard
            title={t(daily ? 'tpChartLeadsDay' : 'tpChartLeadsWeek')}
            legend={outcomeSeries}
            lang={lang}
            table={{
              head: [t('tpColPeriod'), ...outcomeSeries.map(s => s.label), t('tpColTotal')],
              rows: leadBars.map(b => [b.title, ...b.values.map(v => fmtNum(v, lang)), fmtNum(b.values.reduce((a, c) => a + c, 0), lang)]),
            }}
          >
            <BarChart data={leadBars} series={outcomeSeries} kind="count" fmt={v => fmtNum(v, lang)} totalLabel={t('tpColTotal')} />
          </ChartCard>
          <ChartCard
            title={t(daily ? 'tpChartActiveDay' : 'tpChartActiveWeek')}
            sub={selected ? undefined : t('tpChartActiveTeamSub')}
            lang={lang}
            table={{
              head: [t('tpColPeriod'), t('tpColActive')],
              rows: activeBars.map(b => [b.title, b.values[0] ? fmtDur(b.values[0], lang) : '–']),
            }}
          >
            <BarChart data={activeBars} series={[{ label: t('tpActivePerDay'), color: 'var(--tp-act)' }]} kind="minutes" fmt={v => fmtDur(v, lang)}
              tickFmt={v => (v % 60 === 0 && v > 0 ? `${v / 60}${lang === 'nl' ? 'u' : 'h'}` : fmtDur(v, lang))} />
          </ChartCard>
        </div>

        {!selected && (
          <div className="tp-card">
            <div className="tp-card-hd">
              <span className="tp-card-t">{t('tpPerMember')}</span>
              <span className="tp-card-s">{t('tpPerMemberHint')}</span>
            </div>
            <div className="tp-tbl-wrap">
              <table className="tp-tbl">
                <thead>
                  <tr>
                    {([
                      ['name', t('tpColName')], ['p', t('tpColProcessed')], ['sql', t('tpSQL')], ['lto', 'LTO'], ['lost', t('tpLost')],
                      ['time', t('tpColTime')], ['open', t('tpColOpen')], ['done', t('tpColDone')], ['active', t('tpColActive')],
                    ] as [SortKey, string][]).map(([k, label]) => (
                      <th key={k} className="sortable" onClick={() => sortBy(k)} aria-sort={sort.key === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                        {label}{arrow(k)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.m.ownerId} className="click" tabIndex={0}
                      onClick={() => setSelected(r.m.ownerId)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(r.m.ownerId) } }}>
                      <td className="tp-name">{r.m.name}</td>
                      <td>{fmtNum(r.s.p, lang)}</td>
                      <td>{fmtNum(r.s.sql, lang)}<span className="tp-pct">{pct(r.s.sql, r.s.p)}%</span></td>
                      <td>{fmtNum(r.s.lto, lang)}<span className="tp-pct">{pct(r.s.lto, r.s.p)}%</span></td>
                      <td>{fmtNum(r.s.lost, lang)}<span className="tp-pct">{pct(r.s.lost, r.s.p)}%</span></td>
                      <td>{fmtDur(r.time, lang)}</td>
                      <td>{fmtNum(r.open, lang)}{r.overdue > 0 && <span className="tp-pct">({fmtNum(r.overdue, lang)})</span>}</td>
                      <td>{fmtNum(r.s.tc, lang)}</td>
                      <td>{fmtDur(r.active, lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="tp-note" style={{ whiteSpace: 'pre-line' }}>{t('tpNotes', since)}</div>
    </div>
  )
}

// ── Pieces ────────────────────────────────────────────────────────────────────
function Kpi({ label, value, sub, swatch }: { label: string; value: string; sub?: string; swatch?: string }) {
  return (
    <div className="tp-kpi">
      <div className="tp-kpi-l">{swatch && <span className="tp-sw" style={{ background: swatch }} />}{label}</div>
      <div className="tp-kpi-v">{value}</div>
      {sub && <div className="tp-kpi-s">{sub}</div>}
    </div>
  )
}

function ChartCard({ title, sub, legend, table, lang, children }: {
  title: string
  sub?: string
  legend?: { label: string; color: string }[]
  table: { head: string[]; rows: string[][] }
  lang: Lang
  children: ReactNode
}) {
  const [showTable, setShowTable] = useState(false)
  const t = (k: string) => translate(lang, k)
  return (
    <div className="tp-card">
      <div className="tp-card-hd">
        <span className="tp-card-t">{title}</span>
        <button className="tp-link" onClick={() => setShowTable(v => !v)}>{t(showTable ? 'tpHideTable' : 'tpShowTable')}</button>
      </div>
      {sub && <div className="tp-card-s" style={{ marginTop: -4, marginBottom: 6 }}>{sub}</div>}
      {legend && (
        <div className="tp-legend">
          {legend.map(l => <span key={l.label}><span className="tp-sw" style={{ background: l.color }} />{l.label}</span>)}
        </div>
      )}
      {children}
      {showTable && (
        <div className="tp-tbl-wrap" style={{ marginTop: 10, maxHeight: 260, overflowY: 'auto' }}>
          <table className="tp-tbl">
            <thead><tr>{table.head.map(h => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{table.rows.map(r => <tr key={r[0]}>{r.map((c, i) => <td key={i}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}

interface BarDatum { key: string; label: string; title: string; values: number[] }

function niceScale(maxVal: number, kind: 'count' | 'minutes'): { max: number; ticks: number[] } {
  let step: number
  if (kind === 'minutes') {
    step = [5, 10, 15, 30, 60, 120, 180, 240, 300, 360, 480, 600].find(s => maxVal / s <= 4) ?? 600
  } else {
    const raw = Math.max(maxVal, 1) / 4
    const mag = 10 ** Math.floor(Math.log10(raw))
    step = Math.max(1, [1, 2, 5, 10].map(m => m * mag).find(s => s >= raw) ?? 10 * mag)
  }
  const max = Math.max(step, Math.ceil(maxVal / step) * step)
  const ticks: number[] = []
  for (let v = 0; v <= max + 1e-9; v += step) ticks.push(v)
  return { max, ticks }
}

/** Rounded top corners, square at the baseline. */
function barPath(x: number, y: number, w: number, h: number, r: number): string {
  if (r <= 0) return `M${x},${y + h}V${y}H${x + w}V${y + h}Z`
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

function BarChart({ data, series, kind, fmt, tickFmt = fmt, totalLabel, height = 190 }: {
  data: BarDatum[]
  series: { label: string; color: string }[]
  kind: 'count' | 'minutes'
  fmt: (v: number) => string
  tickFmt?: (v: number) => string
  totalLabel?: string
  height?: number
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver(entries => setWidth(Math.floor(entries[0].contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const M = { l: kind === 'minutes' ? 40 : 36, r: 4, t: 8, b: 22 }
  const plotW = Math.max(0, width - M.l - M.r)
  const plotH = height - M.t - M.b
  const totals = data.map(d => d.values.reduce((a, b) => a + b, 0))
  const { max, ticks } = niceScale(Math.max(0, ...totals), kind)
  const band = data.length ? plotW / data.length : 0
  const barW = Math.max(2, Math.min(24, band - Math.max(2, band * 0.3)))
  const y = (v: number) => M.t + plotH - (v / max) * plotH
  const labelEvery = Math.max(1, Math.ceil(44 / Math.max(band, 1)))
  const base0 = y(0)

  const hovered = hover !== null ? data[hover] : null
  const tipX = hover !== null ? Math.min(Math.max(M.l + band * hover + band / 2, 70), Math.max(70, width - 70)) : 0

  return (
    <div className="tp-chart" ref={wrapRef} style={{ height }} onPointerLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={series.map(s => s.label).join(', ')}>
          {ticks.map(v => (
            <g key={v}>
              <line x1={M.l} x2={width - M.r} y1={y(v)} y2={y(v)} stroke="var(--cb)" strokeWidth={1} shapeRendering="crispEdges" />
              <text x={M.l - 6} y={y(v)} dy="0.32em" textAnchor="end" fontSize={10} fill="var(--cs)" style={{ fontVariantNumeric: 'tabular-nums' }}>{tickFmt(v)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = M.l + band * i + (band - barW) / 2
            const topIdx = d.values.reduce((last, v, si) => (v > 0 ? si : last), -1)
            let base = base0
            const segs: JSX.Element[] = []
            d.values.forEach((v, si) => {
              if (v <= 0) return
              const top = base - (v / max) * plotH
              const bottom = base < base0 ? base - 2 : base // 2px surface gap between stacked segments
              const h = bottom - top
              if (h > 0.5) {
                const r = si === topIdx ? Math.min(4, h, barW / 2) : 0
                segs.push(<path key={si} d={barPath(x, top, barW, h, r)} fill={series[si].color} />)
              }
              base = top
            })
            return <g key={d.key} className={hover !== null && hover !== i ? 'tp-dim' : undefined}>{segs}</g>
          })}
          {data.map((d, i) => (i % labelEvery === 0 ? (
            <text key={'x' + d.key} x={M.l + band * i + band / 2} y={height - 6} textAnchor="middle" fontSize={10} fill="var(--cs)">{d.label}</text>
          ) : null))}
          {data.map((d, i) => (
            <rect key={'h' + d.key} className="tp-hit" x={M.l + band * i} y={M.t} width={Math.max(band, 1)} height={plotH} tabIndex={0}
              aria-label={`${d.title}: ${d.values.map((v, si) => `${series[si].label} ${fmt(v)}`).join(', ')}`}
              onPointerEnter={() => setHover(i)} onPointerMove={() => setHover(i)}
              onFocus={() => setHover(i)} onBlur={() => setHover(null)} />
          ))}
        </svg>
      )}
      {hovered && (
        <div className="tp-tip" style={{ left: tipX, top: 0 }}>
          <div className="tp-tip-h">{hovered.title}</div>
          {series.map((s, si) => (
            <div key={s.label} className="tp-tip-r"><span className="tp-tip-k" style={{ background: s.color }} /><b>{fmt(hovered.values[si])}</b> <span style={{ color: 'var(--cs)' }}>{s.label}</span></div>
          ))}
          {series.length > 1 && totalLabel && (
            <div className="tp-tip-r" style={{ borderTop: '1px solid var(--cb)', marginTop: 3, paddingTop: 3 }}>
              <b>{fmt(hovered.values.reduce((a, b) => a + b, 0))}</b> <span style={{ color: 'var(--cs)' }}>{totalLabel}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
