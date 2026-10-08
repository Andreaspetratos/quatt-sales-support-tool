// Team performance (Admin → Team performance): shared definitions and pure logic.
//
// Imported by the Pages Function functions/api/team-perf.js (also via
// lib/teamPerfServer.ts) AND by the admin tab, so it must stay dependency-free:
// no imports, no window, no process.env.
//
// Definitions (agreed with Andreas, 2026-10-08):
//   - Processed lead: a lead in the Consumer Orders pipeline that left MQL
//     (hs_v2_date_exited_<MQL>), counted on the Amsterdam day it left and for its
//     current owner. Same rule as the reps' own Performance drawer.
//   - Outcome: the lead's current stage — SQL, Lost, LTO, anything else is "other".
//   - Time to process: working minutes (Mon–Fri 08:00–18:00 Amsterdam) from the
//     owner being assigned to the lead leaving MQL. HubSpot only keeps the most
//     recent assignment; when that is after the lead left MQL (reassigned later),
//     the clock starts when the lead entered MQL instead. The clock never starts
//     before the lead entered MQL: reps only see MQL leads on their board.

/** HubSpot teams whose members show up in Team performance: production portal, sandbox portal. */
export const TEAM_PERF_TEAM_IDS: string[] = [
  '140339728', // production portal: "Sales Support Team (Dennis)"
  '181494519', // sandbox portal: the same team
]

/** The Consumer Orders lead pipeline went live in HubSpot on this day: nothing to count before it. */
export const HISTORY_START = '2026-08-30'

/** How far back the admin tab can look. */
export const MAX_MONTHS_BACK = 6

export const WORK_DAY_START_H = 8
export const WORK_DAY_END_H = 18

// ── Amsterdam calendar helpers ────────────────────────────────────────────────
// A "day" is a 'YYYY-MM-DD' string in Amsterdam time. Day arithmetic runs on the
// date itself (as if UTC), so DST never shifts a day.
//
// Amsterdam time comes from the EU rule (CET; summer time CEST from the last
// Sunday of March to the last Sunday of October, switching at 01:00 UTC) rather
// than Intl's time zones: Intl is ~25x slower, and a week of leads needs thousands
// of conversions inside a Worker's CPU budget. The tests check it against Intl.

const HOUR_MS = 3600000
const summerTime = new Map<number, [number, number]>()

function summerWindow(y: number): [number, number] {
  let w = summerTime.get(y)
  if (!w) {
    const lastSunday = (month: number) => {
      const last = new Date(Date.UTC(y, month + 1, 0))
      return Date.UTC(y, month, last.getUTCDate() - last.getUTCDay(), 1)
    }
    w = [lastSunday(2), lastSunday(9)]
    summerTime.set(y, w)
  }
  return w
}

/** Amsterdam's offset from UTC at that moment, in ms. */
export function amsOffsetMs(ms: number): number {
  const [start, end] = summerWindow(new Date(ms).getUTCFullYear())
  return ms >= start && ms < end ? 2 * HOUR_MS : HOUR_MS
}

interface AmsParts { y: number; m: number; d: number; h: number; min: number }

export function amsParts(ms: number): AmsParts {
  const t = new Date(ms + amsOffsetMs(ms))
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), min: t.getUTCMinutes() }
}

const pad = (n: number) => String(n).padStart(2, '0')

export function amsDay(ms: number): string {
  const p = amsParts(ms)
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`
}

/** UTC epoch ms of an Amsterdam wall-clock time. */
export function amsToUtc(y: number, m: number, d: number, h = 0, min = 0): number {
  return wallToUtc(Date.UTC(y, m - 1, d, h, min))
}

/** `wall` is an Amsterdam wall-clock time written as if it were UTC. */
function wallToUtc(wall: number): number {
  const summer = wall - 2 * HOUR_MS
  return amsOffsetMs(summer) === 2 * HOUR_MS ? summer : wall - HOUR_MS
}

/** UTC epoch ms of 00:00 Amsterdam on that day. */
export function dayStartUtc(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return amsToUtc(y, m, d)
}

export function dayAdd(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** 0 = Sunday … 6 = Saturday */
export function dayOfWeek(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** Monday of the week the day falls in. */
export function weekStartOf(day: string): string {
  return dayAdd(day, -((dayOfWeek(day) + 6) % 7))
}

/** Same day n months later (or earlier), clamped to the month's last day. */
export function monthAdd(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1 + n, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  return `${first.getUTCFullYear()}-${pad(first.getUTCMonth() + 1)}-${pad(Math.min(d, last))}`
}

export const isDay = (s: unknown): s is string =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && dayAdd(s, 0) === s

/** Every day from `from` to `to`, both included. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to && out.length < 400; d = dayAdd(d, 1)) out.push(d)
  return out
}

/** Mondays of every week that overlaps [from, to]. */
export function weeksCovering(from: string, to: string): string[] {
  const out: string[] = []
  for (let w = weekStartOf(from); w <= to && out.length < 60; w = dayAdd(w, 7)) out.push(w)
  return out
}

// ── Working-hours clock ───────────────────────────────────────────────────────
/** Minutes between two moments that fall Mon–Fri 08:00–18:00 Amsterdam. Public holidays count as working days. */
export function workingMinutes(startMs: number, endMs: number): number {
  if (!(endMs > startMs)) return 0
  let total = 0
  // Walk the Amsterdam dates as UTC-midnight timestamps: no strings in this loop,
  // it runs for every lead of a week inside one Worker request
  const a = amsParts(startMs), b = amsParts(endMs)
  const lastDate = Date.UTC(b.y, b.m - 1, b.d)
  // A lead can sit in MQL for months; 400 days is far beyond the 6-month window
  for (let date = Date.UTC(a.y, a.m - 1, a.d), i = 0; date <= lastDate && i < 400; date += 24 * HOUR_MS, i++) {
    const dow = new Date(date).getUTCDay()
    if (dow === 0 || dow === 6) continue
    const s = Math.max(startMs, wallToUtc(date + WORK_DAY_START_H * HOUR_MS))
    const e = Math.min(endMs, wallToUtc(date + WORK_DAY_END_H * HOUR_MS))
    if (e > s) total += e - s
  }
  return Math.round(total / 60000)
}

// ── Lead and task aggregation (server side, per week) ─────────────────────────
/** One owner's numbers for one Amsterdam day. */
export interface OwnerDayStats {
  /** leads processed (left MQL) */
  p: number
  sql: number
  lost: number
  lto: number
  other: number
  /** working minutes from assignment to processed, one entry per lead with a known start */
  t: number[]
  /** tasks completed */
  tc: number
}

/** Cached per week in KV by /api/team-perf: days → ownerId → stats. */
export interface TeamPerfWeek {
  week: string
  computedAt: number
  /** Team members the week was computed for; a change in the team recomputes it. */
  ownerIds: string[]
  /** LTO stage id it was computed with (differs per portal). */
  lto: string
  days: Record<string, Record<string, OwnerDayStats>>
}

export interface TeamMember { ownerId: string; email: string; name: string }

export interface OpenTaskCount { open: number; overdue: number }

export interface TeamOverview {
  members: TeamMember[]
  /** Open tasks per owner right now. */
  openTasks: Record<string, OpenTaskCount>
  computedAt: number
  historyStart: string
}

export interface StageIds { mql: string; sql: string; lost: string; lto: string }

export const emptyStats = (): OwnerDayStats => ({ p: 0, sql: 0, lost: 0, lto: 0, other: 0, t: [], tc: 0 })

function slot(days: TeamPerfWeek['days'], day: string, ownerId: string): OwnerDayStats {
  const d = days[day] || (days[day] = {})
  return d[ownerId] || (d[ownerId] = emptyStats())
}

const ms = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : /^\d+$/.test(String(v)) ? Number(v) : Date.parse(String(v))
  return Number.isFinite(n) ? n : null
}

/** Count one HubSpot lead (search result `properties`) into the week. */
export function addLead(days: TeamPerfWeek['days'], props: Record<string, any>, stages: StageIds): void {
  const ownerId = String(props.hubspot_owner_id || '')
  const exited = ms(props[`hs_v2_date_exited_${stages.mql}`])
  if (!ownerId || exited === null) return
  const s = slot(days, amsDay(exited), ownerId)
  s.p++
  const stage = String(props.hs_pipeline_stage || '')
  if (stage === stages.sql) s.sql++
  else if (stage === stages.lost) s.lost++
  else if (stage === stages.lto) s.lto++
  else s.other++

  const entered = ms(props[`hs_v2_date_entered_${stages.mql}`])
  const assigned = ms(props.hubspot_owner_assigneddate)
  let start: number | null = null
  if (assigned !== null && assigned <= exited) start = entered !== null ? Math.max(assigned, entered) : assigned
  else if (entered !== null && entered <= exited) start = entered
  if (start !== null) s.t.push(workingMinutes(start, exited))
}

/** Count one completed HubSpot task into the week. */
export function addCompletedTask(days: TeamPerfWeek['days'], props: Record<string, any>): void {
  const ownerId = String(props.hubspot_owner_id || '')
  const done = ms(props.hs_task_completion_date)
  if (!ownerId || done === null) return
  slot(days, amsDay(done), ownerId).tc++
}

// ── Summing for the admin tab ─────────────────────────────────────────────────
export interface PerfTotals extends OwnerDayStats {}

function addInto(into: OwnerDayStats, s: OwnerDayStats) {
  into.p += s.p; into.sql += s.sql; into.lost += s.lost; into.lto += s.lto; into.other += s.other; into.tc += s.tc
  for (const x of s.t) into.t.push(x)
}

export interface RangeSums {
  total: PerfTotals
  byOwner: Record<string, PerfTotals>
  byDay: Record<string, PerfTotals>
}

/** Sum the loaded weeks over [from, to] for the given owners. */
export function sumRange(weeks: TeamPerfWeek[], from: string, to: string, ownerIds: string[]): RangeSums {
  const owners = new Set(ownerIds)
  const total = emptyStats()
  const byOwner: Record<string, PerfTotals> = {}
  const byDay: Record<string, PerfTotals> = {}
  for (const id of ownerIds) byOwner[id] = emptyStats()
  for (const w of weeks) {
    for (const [day, perOwner] of Object.entries(w.days)) {
      if (day < from || day > to) continue
      for (const [ownerId, s] of Object.entries(perOwner)) {
        if (!owners.has(ownerId)) continue
        addInto(total, s)
        addInto(byOwner[ownerId], s)
        addInto(byDay[day] || (byDay[day] = emptyStats()), s)
      }
    }
  }
  return { total, byOwner, byDay }
}

export function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}
