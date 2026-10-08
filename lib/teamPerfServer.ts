// Server-only helpers for Team performance — used by the Pages Functions
// functions/api/team-perf.js and functions/api/activity.js. Not imported by the
// frontend. Talks to HubSpot directly with the portal's token (never sent to the
// browser), the same way the auth middleware's admin check does.

import { TEAM_PERF_TEAM_IDS, type TeamMember } from './teamPerf'

const HS = 'https://api.hubapi.com'

/** One HubSpot call. Retries a 429 (shared search rate limit) a few times before giving up. */
export async function hubspot(token: string, method: string, path: string, body?: unknown): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(HS + path, {
      method,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (res.status === 429 && attempt < 4) {
      const wait = Number(res.headers.get('Retry-After')) * 1000 || 600 * (attempt + 1)
      await new Promise(r => setTimeout(r, Math.min(wait, 5000)))
      continue
    }
    const text = await res.text()
    if (!res.ok) throw new Error(`HubSpot ${method} ${path.split('?')[0]} → ${res.status}: ${text.slice(0, 300)}`)
    return text ? JSON.parse(text) : {}
  }
}

/** Every result of a CRM search, following `after` (HubSpot stops at 10,000). */
export async function searchAll(token: string, objectType: string, body: Record<string, unknown>, limit = 200): Promise<any[]> {
  const out: any[] = []
  let after: string | undefined
  for (let page = 0; page < 100; page++) {
    const data = await hubspot(token, 'POST', `/crm/v3/objects/${objectType}/search`, { ...body, limit, ...(after ? { after } : {}) })
    out.push(...(data.results || []))
    after = data.paging?.next?.after
    if (!after) break
    if (Number(after) >= 10000) throw new Error(`Too many ${objectType} for one search (over 10,000) — narrow the range`)
  }
  return out
}

// ── Team members ──────────────────────────────────────────────────────────────
// Members of TEAM_PERF_TEAM_IDS (primary or secondary team), as HubSpot owners.
// Cached in KV for an hour and in memory for 5 minutes: every heartbeat to
// /api/activity checks membership, and the lookup costs several HubSpot calls.

const MEMBERS_KEY = 'teamperf:members:v1'
const MEMBERS_KV_TTL_MS = 60 * 60 * 1000
const MEMBERS_MEM_TTL_MS = 5 * 60 * 1000
let memMembers: { at: number; members: TeamMember[] } | null = null

export function hubspotToken(env: any): string {
  return env.HUBSPOT_TOKEN_PROD || env.HUBSPOT_TOKEN || ''
}

export async function loadTeamMembers(env: any, force = false): Promise<TeamMember[]> {
  const now = Date.now()
  if (!force && memMembers && now - memMembers.at < MEMBERS_MEM_TTL_MS) return memMembers.members
  const kv = env.PLAYBOOKS_KV
  if (!force && kv) {
    const cached = await kv.get(MEMBERS_KEY, 'json').catch(() => null) as { at: number; members: TeamMember[] } | null
    if (cached && now - cached.at < MEMBERS_KV_TTL_MS) {
      memMembers = cached
      return cached.members
    }
  }
  const members = await fetchTeamMembers(hubspotToken(env))
  memMembers = { at: now, members }
  if (kv) await kv.put(MEMBERS_KEY, JSON.stringify(memMembers)).catch((e: unknown) => console.error('[team] members cache write failed:', String(e)))
  return members
}

async function fetchTeamMembers(token: string): Promise<TeamMember[]> {
  if (!token) throw new Error('HUBSPOT_TOKEN not configured')
  // Same lookup as fetchOwnersByTeams() in lib/hubspot.ts: the team is on the
  // user object (primary id, or ';'-joined secondary teams), and the email is
  // the only safe key from a user to its owner id.
  const users = await searchAll(token, 'users', {
    filterGroups: [
      ...TEAM_PERF_TEAM_IDS.map(id => ({ filters: [{ propertyName: 'hubspot_team_id', operator: 'EQ', value: id }] })),
      ...TEAM_PERF_TEAM_IDS.map(id => ({ filters: [{ propertyName: 'hs_user_secondary_teams', operator: 'CONTAINS_TOKEN', value: id }] })),
    ],
    properties: ['hs_email', 'hubspot_team_id', 'hs_user_secondary_teams'],
  }, 100)
  const emails = new Set<string>()
  for (const u of users) {
    const p = u.properties || {}
    const teams = [p.hubspot_team_id || '', ...String(p.hs_user_secondary_teams || '').split(';')].map((t: string) => t.trim())
    if (p.hs_email && teams.some((t: string) => TEAM_PERF_TEAM_IDS.includes(t))) emails.add(String(p.hs_email).toLowerCase())
  }
  if (!emails.size) return []

  const members: TeamMember[] = []
  let after: string | undefined
  for (let page = 0; page < 20; page++) {
    const data = await hubspot(token, 'GET', `/crm/v3/owners?limit=100&archived=false${after ? `&after=${after}` : ''}`)
    for (const o of data.results || []) {
      const email = String(o.email || '').toLowerCase()
      if (emails.has(email)) {
        members.push({ ownerId: String(o.id), email, name: [o.firstName, o.lastName].filter(Boolean).join(' ').trim() || email })
      }
    }
    after = data.paging?.next?.after
    if (!after) break
  }
  return members.sort((a, b) => a.name.localeCompare(b.name))
}
