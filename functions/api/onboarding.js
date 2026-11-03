/**
 * Quick start guide (components/QuickStart.tsx): has the signed-in user seen it?
 * GET    /api/onboarding → { seen }
 * POST   /api/onboarding → marks it seen (Next to the end, Skip or ✕)
 * DELETE /api/onboarding → shows it again at this user's next login (testing)
 *
 * It opens on the first login of an email address, not of a browser, so the
 * flag lives in KV under onboarding:v1:<email>: an ISO date once seen, 'reset'
 * after a DELETE.
 *
 * The tool kept no record of who had logged in before this, and Andreas wanted
 * only new people to get the guide (2026-11-03). So the first GET after release
 * takes one snapshot of who already works with it, stored under
 * onboarding:v1:existing: the members of the tool's HubSpot teams, ADMINS and
 * everyone who ever sent feedback. An email in that snapshot counts as seen.
 * Someone who joins a team later isn't in it and gets the guide. If HubSpot
 * can't be reached, nothing is stored and the guide stays closed; the next
 * login tries again.
 */
import { ADMINS, ADMIN_TEAM_IDS } from '../../lib/access'
import { TEAM_PERF_TEAM_IDS } from '../../lib/teamPerf'
import { hubspotToken, searchAll } from '../../lib/teamPerfServer'

const SEEN_KEY = email => `onboarding:v1:${email}`
const EXISTING_KEY = 'onboarding:v1:existing'

// Who works in the tool: Sales Support (TEAM_PERF_TEAM_IDS, both portals),
// Technical Sales Calls (CONFIG.TASK_ASSIGNEE_TEAMS in lib/config.ts, which
// can't be imported here: it reads process.env) and the admin teams.
const TOOL_TEAM_IDS = [...TEAM_PERF_TEAM_IDS, '146180338', ...ADMIN_TEAM_IDS]

export async function onRequest(ctx) {
  const kv = ctx.env.PLAYBOOKS_KV
  if (!kv) return json({ error: 'KV not configured' }, 500)
  const email = String(ctx.data.user?.email || '').toLowerCase()
  if (!email) return json({ error: 'Not signed in' }, 401)
  const method = ctx.request.method

  if (method === 'GET') {
    const flag = await kv.get(SEEN_KEY(email))
    if (flag === 'reset') return json({ seen: false })
    if (flag) return json({ seen: true })
    const existing = await existingUsers(ctx.env)
    // Snapshot not available: keep the guide closed rather than show it to everyone
    if (!existing) return json({ seen: true })
    return json({ seen: existing.includes(email) })
  }

  if (method === 'POST') {
    await kv.put(SEEN_KEY(email), new Date().toISOString())
    return json({ ok: true })
  }

  if (method === 'DELETE') {
    await kv.put(SEEN_KEY(email), 'reset')
    return json({ ok: true })
  }

  return json({ error: 'Method not allowed' }, 405)
}

/** The emails that used the tool before the guide existed, taken once. null = couldn't be taken. */
async function existingUsers(env) {
  const kv = env.PLAYBOOKS_KV
  const stored = await kv.get(EXISTING_KEY, 'json').catch(() => null)
  if (stored && Array.isArray(stored.emails)) return stored.emails

  try {
    const emails = new Set(ADMINS.map(e => e.toLowerCase()))
    const feedbacks = JSON.parse(await kv.get('feedbacks') ?? '[]')
    for (const f of feedbacks) if (f?.submittedBy) emails.add(String(f.submittedBy).toLowerCase())

    const token = hubspotToken(env)
    if (!token) throw new Error('HUBSPOT_TOKEN not configured')
    // Same team lookup as the Team performance members (lib/teamPerfServer.ts), one
    // search per team: HubSpot allows at most 5 filter groups in a search
    for (const id of TOOL_TEAM_IDS) {
      const users = await searchAll(token, 'users', {
        filterGroups: [
          { filters: [{ propertyName: 'hubspot_team_id', operator: 'EQ', value: id }] },
          { filters: [{ propertyName: 'hs_user_secondary_teams', operator: 'CONTAINS_TOKEN', value: id }] },
        ],
        properties: ['hs_email'],
      }, 100)
      for (const u of users) if (u.properties?.hs_email) emails.add(String(u.properties.hs_email).toLowerCase())
    }

    const list = [...emails].filter(e => e.includes('@')).sort()
    await kv.put(EXISTING_KEY, JSON.stringify({ takenAt: new Date().toISOString(), teams: TOOL_TEAM_IDS, emails: list }))
    console.log(`[onboarding] snapshot of existing users taken: ${list.length} emails`)
    return list
  } catch (e) {
    console.error('[onboarding] could not take the existing-users snapshot:', String(e))
    return null
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}
