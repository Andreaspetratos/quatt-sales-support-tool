/**
 * Admin → Team performance. Admin-only (enforced in _middleware.js).
 *
 * GET /api/team-perf                    → TeamOverview: team members + open tasks per member right now
 * GET /api/team-perf?week=YYYY-MM-DD    → TeamPerfWeek: per day, per member, the leads processed
 *                                         (with outcome and time to process) and tasks completed
 *                                         in the week starting that Monday (Amsterdam time)
 * Add &force=1 to skip the caches (the tab's Refresh button).
 *
 * Weeks are computed from HubSpot and cached in KV (key teamperf:v1:week:<monday>), so
 * a 6-month view doesn't page through ~20,000 leads every time an admin opens the tab.
 * A cached week is recomputed when it is older than its TTL below, when the team's
 * members changed, or when the LTO stage id changed. Outcomes are the lead's current
 * stage, so an older week can still move a little (an LTO lead that later turns SQL);
 * the TTLs keep that drift to hours for recent weeks and 1–2 weeks for old ones.
 *
 * Definitions: lib/teamPerf.ts. The browser can't run these searches through
 * /api/hs-write in one go: HubSpot's search rate limit is shared with the reps' boards.
 */
import {
  HISTORY_START, isDay, dayOfWeek, dayAdd, amsDay, dayStartUtc,
  addLead, addCompletedTask,
} from '../../lib/teamPerf'
import { hubspotToken, loadTeamMembers, searchAll } from '../../lib/teamPerfServer'

// Same ids as CONFIG in lib/config.ts (which can't be imported here: it reads process.env)
const PIPELINE_ID = '3837045967'
const MQL = '5404393694'
const SQL = '5404393697'
const LOST = '5404393698'

const MIN = 60 * 1000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const WEEK_KEY = week => `teamperf:v1:week:${week}`

export async function onRequestGet(ctx) {
  const { env, request } = ctx
  const url = new URL(request.url)
  const force = url.searchParams.get('force') === '1'
  const week = url.searchParams.get('week')
  const token = hubspotToken(env)
  if (!token) return json({ error: 'HUBSPOT_TOKEN not configured' }, 500)

  try {
    const members = await loadTeamMembers(env, force)
    const ownerIds = members.map(m => m.ownerId)

    if (week === null) {
      return json({
        members,
        openTasks: await openTasks(token, ownerIds),
        computedAt: Date.now(),
        historyStart: HISTORY_START,
      })
    }

    if (!isDay(week) || dayOfWeek(week) !== 1) return json({ error: 'week must be a Monday, YYYY-MM-DD' }, 400)
    const today = amsDay(Date.now())
    if (week > today) return json({ error: 'week is in the future' }, 400)
    const lto = env.NEXT_PUBLIC_LTO_STAGE_ID || '6021605583'
    const empty = { week, computedAt: Date.now(), ownerIds, lto, days: {} }
    // Before the pipeline existed, or nobody in the team: nothing to ask HubSpot
    if (dayAdd(week, 7) <= HISTORY_START || ownerIds.length === 0) return json(empty)

    const kv = env.PLAYBOOKS_KV
    if (!force && kv) {
      const cached = await kv.get(WEEK_KEY(week), 'json').catch(() => null)
      if (cached && cached.lto === lto && sameSet(cached.ownerIds, ownerIds) && Date.now() - cached.computedAt < ttl(week, today)) {
        return json(cached)
      }
    }

    const result = await computeWeek(token, week, ownerIds, lto)
    if (kv) {
      // Expires on its own long after it drops out of the 6-month window
      await kv.put(WEEK_KEY(week), JSON.stringify(result), { expirationTtl: 220 * 24 * 60 * 60 })
        .catch(e => console.error('[team-perf] cache write failed:', week, String(e)))
    }
    return json(result)
  } catch (e) {
    console.error('[team-perf] ✗', week ?? 'overview', String(e))
    return json({ error: String(e?.message || e) }, 502)
  }
}

/** How long a cached week stays valid. */
function ttl(week, today) {
  if (today < dayAdd(week, 7)) return 5 * MIN               // this week: near live
  if (today < dayAdd(week, 7 + 28)) return 6 * HOUR         // last 4 weeks: outcomes still move
  // Older: 7–13 days, spread by date so a 6-month view never has to recompute all
  // ~27 weeks on the same day
  return (7 + (Number(week.slice(8, 10)) % 7)) * DAY
}

async function computeWeek(token, week, ownerIds, lto) {
  const from = String(Math.max(dayStartUtc(week), dayStartUtc(HISTORY_START)))
  const to = String(dayStartUtc(dayAdd(week, 7)))
  const exited = `hs_v2_date_exited_${MQL}`
  const stages = { mql: MQL, sql: SQL, lost: LOST, lto }

  const leads = await searchAll(token, 'leads', {
    filterGroups: [{ filters: [
      { propertyName: 'hs_pipeline', operator: 'EQ', value: PIPELINE_ID },
      { propertyName: exited, operator: 'GTE', value: from },
      { propertyName: exited, operator: 'LT', value: to },
      { propertyName: 'hubspot_owner_id', operator: 'IN', values: ownerIds },
    ] }],
    properties: ['hubspot_owner_id', 'hs_pipeline_stage', exited, `hs_v2_date_entered_${MQL}`, 'hubspot_owner_assigneddate'],
    sorts: [{ propertyName: exited, direction: 'ASCENDING' }],
  })
  const tasks = await searchAll(token, 'tasks', {
    filterGroups: [{ filters: [
      { propertyName: 'hs_task_status', operator: 'EQ', value: 'COMPLETED' },
      { propertyName: 'hs_task_completion_date', operator: 'GTE', value: from },
      { propertyName: 'hs_task_completion_date', operator: 'LT', value: to },
      { propertyName: 'hubspot_owner_id', operator: 'IN', values: ownerIds },
    ] }],
    properties: ['hubspot_owner_id', 'hs_task_completion_date'],
    sorts: [{ propertyName: 'hs_task_completion_date', direction: 'ASCENDING' }],
  })

  const days = {}
  for (const l of leads) addLead(days, l.properties || {}, stages)
  for (const t of tasks) addCompletedTask(days, t.properties || {})
  return { week, computedAt: Date.now(), ownerIds, lto, days }
}

/** Open (not completed) tasks per owner right now, and how many are past their due date. Same tasks as each rep's Tasks tab. */
async function openTasks(token, ownerIds) {
  const out = {}
  for (const id of ownerIds) out[id] = { open: 0, overdue: 0 }
  if (!ownerIds.length) return out
  const tasks = await searchAll(token, 'tasks', {
    filterGroups: [{ filters: [
      { propertyName: 'hs_task_status', operator: 'NEQ', value: 'COMPLETED' },
      { propertyName: 'hubspot_owner_id', operator: 'IN', values: ownerIds },
    ] }],
    properties: ['hubspot_owner_id', 'hs_timestamp'],
  })
  const now = Date.now()
  for (const t of tasks) {
    const p = t.properties || {}
    const row = out[String(p.hubspot_owner_id)]
    if (!row) continue
    row.open++
    const due = Date.parse(p.hs_timestamp || '')
    if (Number.isFinite(due) && due < now) row.overdue++
  }
  return out
}

function sameSet(a, b) {
  if (!Array.isArray(a) || a.length !== b.length) return false
  const s = new Set(a)
  return b.every(x => s.has(x))
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}
