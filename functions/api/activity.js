/**
 * Active time in the tool, for Admin → Team performance. Stored in the D1 database
 * bound as ACTIVITY_DB (wrangler.toml): a separate database per environment.
 *
 * POST /api/activity  { minutes: number[] }   any signed-in user (lib/activity.ts)
 *   `minutes` are epoch minutes (Date.now() / 60000, floored) in which the tool was
 *   the visible tab and the user was active in the last 5 minutes. Only members of
 *   the Team performance team (lib/teamPerf.ts) are stored; anyone else gets
 *   { tracked: false } and their browser stops sending. The email comes from the
 *   verified sign-in, never from the body.
 * GET /api/activity?from=YYYY-MM-DD&to=YYYY-MM-DD   admin-only (_middleware.js)
 *   → ActivityData: active minutes per Amsterdam day per email.
 *
 * Without the ACTIVITY_DB binding both answer "not configured" and nothing breaks.
 */
import { isDay, dayAdd, minutesToRows, popcount } from '../../lib/teamPerf'
import { loadTeamMembers } from '../../lib/teamPerfServer'

const MAX_AGE_MIN = 36 * 60    // a browser that slept overnight may still send yesterday's minutes
const MAX_MINUTES = 3000
const MAX_RANGE_DAYS = 200

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS activity_minutes (
     email TEXT NOT NULL,
     day   TEXT NOT NULL,
     hour  INTEGER NOT NULL,
     lo    INTEGER NOT NULL DEFAULT 0,
     hi    INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (email, day, hour)
   )`,
  `CREATE INDEX IF NOT EXISTS activity_minutes_day ON activity_minutes (day)`,
]
const UPSERT = `INSERT INTO activity_minutes (email, day, hour, lo, hi) VALUES (?1, ?2, ?3, ?4, ?5)
  ON CONFLICT (email, day, hour) DO UPDATE SET lo = lo | excluded.lo, hi = hi | excluded.hi`

let schemaReady = false
async function ensureSchema(db) {
  if (schemaReady) return
  await db.batch(SCHEMA.map(sql => db.prepare(sql)))
  schemaReady = true
}

export async function onRequestPost(ctx) {
  const db = ctx.env.ACTIVITY_DB
  if (!db) return json({ tracked: false, reason: 'not-configured' })
  const email = String(ctx.data.user?.email || '').toLowerCase()
  if (!email) return json({ tracked: false, reason: 'no-user' })

  let body
  try { body = await ctx.request.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
  if (!Array.isArray(body?.minutes)) return json({ error: 'minutes must be an array' }, 400)

  try {
    const members = await loadTeamMembers(ctx.env)
    if (!members.some(m => m.email === email)) return json({ tracked: false, reason: 'not-in-team' })

    const now = Math.floor(Date.now() / 60000)
    const minutes = Array.from(new Set(body.minutes.slice(0, MAX_MINUTES)))
      .filter(m => Number.isInteger(m) && m <= now + 1 && m >= now - MAX_AGE_MIN)
    if (minutes.length) {
      await ensureSchema(db)
      const rows = minutesToRows(minutes)
      await db.batch(rows.map(r => db.prepare(UPSERT).bind(email, r.day, r.hour, r.lo, r.hi)))
    }
    return json({ tracked: true, stored: minutes.length })
  } catch (e) {
    console.error('[activity] ✗ store failed for', email, String(e))
    return json({ error: 'Could not store activity' }, 502)
  }
}

export async function onRequestGet(ctx) {
  const db = ctx.env.ACTIVITY_DB
  if (!db) return json({ configured: false, since: null, days: {} })
  const url = new URL(ctx.request.url)
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  if (!isDay(from) || !isDay(to) || from > to) return json({ error: 'from and to must be YYYY-MM-DD, from ≤ to' }, 400)
  if (dayAdd(from, MAX_RANGE_DAYS) < to) return json({ error: `Range is limited to ${MAX_RANGE_DAYS} days` }, 400)

  try {
    await ensureSchema(db)
    const { results = [] } = await db
      .prepare('SELECT email, day, lo, hi FROM activity_minutes WHERE day >= ?1 AND day <= ?2')
      .bind(from, to).all()
    const days = {}
    for (const r of results) {
      const d = days[r.day] || (days[r.day] = {})
      d[r.email] = (d[r.email] || 0) + popcount(Number(r.lo)) + popcount(Number(r.hi))
    }
    const first = await db.prepare('SELECT MIN(day) AS since FROM activity_minutes').first()
    return json({ configured: true, since: first?.since ?? null, days })
  } catch (e) {
    console.error('[activity] ✗ read failed', String(e))
    return json({ error: 'Could not read activity' }, 502)
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}
