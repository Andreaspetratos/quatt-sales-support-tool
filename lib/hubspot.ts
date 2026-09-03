import type { Lead, PerfData, PerfPeriodData } from './types'
import { CONFIG, isDemo } from './config'

// ── Properties to fetch for every lead ───────────────────────────────────────
const LEAD_PROPS = [
  'hs_lead_name',
  'hubspot_owner_id',
  'hs_pipeline',
  'hs_pipeline_stage',
  'phone_number',
  'city',
  'postal_code',
  'street_lead',
  'house_number',
  'house_number_suffix',
  'most_recent_selected_product_lead',
  'qualificationcalloutcome_lead',
  'most_recent_form_origin_lead',
  'partner_name_lead',
  'screening_call_requested_at',
  'lead_router_qualification_score_lead',
  'contact_email',
  'hs_primary_contact_id',   // used to link straight to the contact from the lead modal
  'qualification_call_result_lead',
  'postnl_adrescheck_status',  // drives the address-check dot in the lead modal
]

// ── Demo data ─────────────────────────────────────────────────────────────────
const DEMO_LEADS: Lead[] = [
  { id: '1', properties: { hs_lead_name: 'Lars Haringa',          phone_number: '+31 6 51342788', city: 'Amsterdam',  house_number: '12',  house_number_suffix: 'A', most_recent_selected_product_lead: 'Hybrid Single, Chill', qualificationcalloutcome_lead: '--', most_recent_form_origin_lead: 'Configurator',     partner_name_lead: '--',  lead_router_qualification_score_lead: '82', screening_call_requested_at: new Date().toISOString(),            hs_pipeline: '3837045967', hs_pipeline_stage: '5404393700' } },
  { id: '2', properties: { hs_lead_name: 'Edwin Kamer',           phone_number: '+31 6 20234646', city: 'Rotterdam',  house_number: '45',  house_number_suffix: '',  most_recent_selected_product_lead: 'Hybrid Single',        qualificationcalloutcome_lead: '--', most_recent_form_origin_lead: 'Savings Check',    partner_name_lead: '--',  lead_router_qualification_score_lead: '67', screening_call_requested_at: '',                                  hs_pipeline: '3837045967', hs_pipeline_stage: '5404393694' } },
  { id: '3', properties: { hs_lead_name: 'Jan Verbakel',          phone_number: '+31 6 55111145', city: 'Utrecht',    house_number: '7',   house_number_suffix: 'B', most_recent_selected_product_lead: 'Hybrid Single, Chill', qualificationcalloutcome_lead: '--', most_recent_form_origin_lead: 'Configurator',     partner_name_lead: '--',  lead_router_qualification_score_lead: '54', screening_call_requested_at: '',                                  hs_pipeline: '3837045967', hs_pipeline_stage: '5404393694' } },
  { id: '4', properties: { hs_lead_name: 'Marcel Van Kesteren',   phone_number: '+31 6 51387652', city: 'Den Haag',   house_number: '103', house_number_suffix: '',  most_recent_selected_product_lead: 'Hybrid Duo',           qualificationcalloutcome_lead: '--', most_recent_form_origin_lead: 'Download Brochure', partner_name_lead: '--',  lead_router_qualification_score_lead: '41', screening_call_requested_at: new Date(Date.now()-900000).toISOString(), hs_pipeline: '3837045967', hs_pipeline_stage: '5404393700' } },
  { id: '5', properties: { hs_lead_name: 'I.M. Luddickhuizen',   phone_number: '+31 6 13694594', city: 'Eindhoven',  house_number: '22',  house_number_suffix: '',  most_recent_selected_product_lead: 'Hybrid Single',        qualificationcalloutcome_lead: 'No answer',         most_recent_form_origin_lead: 'Partner',           partner_name_lead: 'VEH', lead_router_qualification_score_lead: '30', screening_call_requested_at: new Date(Date.now()-1800000).toISOString(), hs_pipeline: '3837045967', hs_pipeline_stage: '5404393697' } },
  { id: '6', properties: { hs_lead_name: 'Martin Van der Meirsch',phone_number: '+31 6 14189870', city: 'Groningen',  house_number: '8',   house_number_suffix: 'C', most_recent_selected_product_lead: 'Hybrid Duo',           qualificationcalloutcome_lead: '--', most_recent_form_origin_lead: 'Direct offerte',    partner_name_lead: '--',  lead_router_qualification_score_lead: '91', screening_call_requested_at: '',                                  hs_pipeline: '3837045967', hs_pipeline_stage: '5404393694' } },
]

// ── Error parsing ─────────────────────────────────────────────────────────────
// Central helper: converts a HubSpot error response body into a readable string.
// Always includes validationResults field names so you know exactly what failed.
function _parseHsError(bodyText: string): string {
  try {
    const d = JSON.parse(bodyText)
    let msg = d.message || d.error || JSON.stringify(d).slice(0, 300)
    if (Array.isArray(d.validationResults) && d.validationResults.length > 0) {
      const fields = d.validationResults
        .map((r: { name?: string; message?: string; error?: string }) =>
          [r.name, r.error, r.message].filter(Boolean).join(':'))
        .join(', ')
      msg += ` — fields: [${fields}]`
    }
    if (d.context) msg += ` — context: ${JSON.stringify(d.context).slice(0, 100)}`
    return msg
  } catch {
    return bodyText.slice(0, 400)
  }
}

// ── API helpers ───────────────────────────────────────────────────────────────
// All HubSpot traffic routes through the server-side proxy (/api/hs-write).
// hsProxy is the single point where ALL requests are logged.
// Any non-2xx response logs the full body immediately — callers don't need to.
async function hsProxy(method: string, path: string, body?: unknown): Promise<Response> {
  const label = `[hs] ${method} ${path}`
  const res = await fetch('/api/hs-write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, path, body }),
  })
  if (!res.ok) {
    // Clone so the body stream is still available for callers that need to read it
    res.clone().text()
      .then(t => console.error(`${label} → ${res.status}`, _parseHsError(t)))
      .catch(() => console.error(`${label} → ${res.status} (could not read body)`))
  }
  return res
}

// Retry wrapper — retries 429 (rate-limit) and 5xx with exponential backoff.
async function retryProxy(
  method: string,
  path: string,
  body?: unknown,
  maxAttempts = 3,
): Promise<Response> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const delay = 1000 * Math.pow(2, attempt - 1)
      console.warn(`[hs] retry #${attempt} ${method} ${path} in ${delay}ms`)
      await new Promise(r => setTimeout(r, delay))
    }
    try {
      const res = await hsProxy(method, path, body)
      if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts - 1) continue
      return res
    } catch (e) {
      if (attempt === maxAttempts - 1) throw e
      console.warn(`[hs] network error on attempt ${attempt + 1}:`, e)
    }
  }
  return hsProxy(method, path, body) // unreachable; satisfies TypeScript
}

// Per-lead write queue — sequential writes per lead to avoid races.
const _leadQueues = new Map<string, Promise<void>>()
function queueForLead(id: string, task: () => Promise<void>): Promise<void> {
  const prev = _leadQueues.get(id) ?? Promise.resolve()
  const execution = prev.then(task)
  const chain = execution.catch(() => {})
  _leadQueues.set(id, chain)
  chain.finally(() => { if (_leadQueues.get(id) === chain) _leadQueues.delete(id) })
  return execution
}

// Write success event — subscribing components trigger re-fetches after writes.
type WriteListener = (leadId: string) => void
const _writeListeners: WriteListener[] = []
export function onLeadWrite(cb: WriteListener): () => void {
  _writeListeners.push(cb)
  return () => { const i = _writeListeners.indexOf(cb); if (i >= 0) _writeListeners.splice(i, 1) }
}
function _notifyWrite(leadId: string): void { _writeListeners.forEach(cb => cb(leadId)) }

// ── User / Owner ID lookup ────────────────────────────────────────────────────
export async function lookupHubspotUserId(email: string): Promise<string | null> {
  if (isDemo() || !email) return null
  try {
    const res = await hsProxy('POST', '/crm/v3/objects/users/search', {
      filterGroups: [{ filters: [{ propertyName: 'hs_email', operator: 'EQ', value: email }] }],
      properties: ['hs_email'],
      limit: 1,
    })
    if (!res.ok) return null // logged by hsProxy
    const data = await res.json()
    const id = data.results?.[0]?.id ?? null
    if (!id) console.warn('[hs] lookupHubspotUserId: no user found for', email)
    return id
  } catch (e) {
    console.error('[hs] lookupHubspotUserId error:', e)
    return null
  }
}

// IMPORTANT: Users CRM object ID ≠ owners ID — only email is a safe cross-system key.
export async function lookupHubspotOwnerId(email: string): Promise<string | null> {
  if (isDemo() || !email) return null
  try {
    const res = await hsProxy('GET', '/crm/v3/owners?email=' + encodeURIComponent(email) + '&limit=1')
    if (!res.ok) return null // logged by hsProxy
    const data = await res.json()
    const id = data.results?.[0]?.id
    if (!id) console.warn('[hs] lookupHubspotOwnerId: no owner found for', email)
    return id ? String(id) : null
  } catch (e) {
    console.error('[hs] lookupHubspotOwnerId error:', e)
    return null
  }
}


/** Fetch all HubSpot owners (for task assignee picker). */
export async function fetchAllOwners(): Promise<Array<{ id: string; email: string; name: string }>> {
  if (isDemo()) return []
  try {
    const res = await hsProxy('GET', '/crm/v3/owners?limit=100&archived=false')
    if (!res.ok) return [] // logged by hsProxy
    const data = await res.json()
    return ((data.results || []) as any[]).map(o => ({
      id: String(o.id),
      email: String(o.email || ''),
      name: [o.firstName, o.lastName].filter(Boolean).join(' ') || o.email || String(o.id),
    }))
  } catch (e) {
    console.error('[hs] fetchAllOwners error:', e)
    return []
  }
}


export interface TeamOwner {
  id: string
  email: string
  name: string
  /** Wanted team ids this owner belongs to — may be more than one. */
  teamIds: string[]
}

/**
 * Fetch owners belonging to any of the given HubSpot teams.
 *
 * Checks primary AND secondary team membership: filtering on hubspot_team_id
 * alone misses anyone whose primary team is something else but who is also a
 * member of the team we care about — which is common, since most reps sit in
 * several teams.
 *
 * Each owner carries back the wanted team ids they matched, so the caller can
 * group them without a second round of lookups.
 */
export async function fetchOwnersByTeams(teamIds: string[]): Promise<TeamOwner[]> {
  if (isDemo() || !teamIds.length) return []
  const wanted = new Set(teamIds.map(String))
  try {
    // Filter server-side on the team. Pulling every user and filtering here
    // does not work: the search pages at 100 and this portal has thousands, so
    // an unfiltered query returned whoever landed on the first page or two.
    //
    // Two sets of OR'd groups because membership lives in two properties: the
    // primary team is a plain id, secondary teams are a semicolon-joined string
    // (hence CONTAINS_TOKEN rather than EQ).
    const users: any[] = []
    let userAfter: string | undefined = undefined
    for (let page = 0; page < 10; page++) {
      const body: Record<string, unknown> = {
        filterGroups: [
          ...teamIds.map(id => ({
            filters: [{ propertyName: 'hubspot_team_id', operator: 'EQ', value: String(id) }],
          })),
          ...teamIds.map(id => ({
            filters: [{ propertyName: 'hs_user_secondary_teams', operator: 'CONTAINS_TOKEN', value: String(id) }],
          })),
        ],
        properties: ['hs_email', 'hubspot_team_id', 'hs_user_secondary_teams'],
        limit: 100,
      }
      if (userAfter) body.after = userAfter
      const searchRes = await hsProxy('POST', '/crm/v3/objects/users/search', body)
      if (!searchRes.ok) {
        console.error('[hs] fetchOwnersByTeams search failed:', searchRes.status)
        break
      }
      const data = await searchRes.json()
      users.push(...(data.results || []))
      userAfter = data.paging?.next?.after
      if (!userAfter) break
    }
    if (users.length === 0) return []
    // Re-check client-side: CONTAINS_TOKEN can match loosely, so verify the id
    // really is one of the wanted teams before trusting the row. Email is the
    // only safe key back to the owners API — the users object id is not the
    // owner id.
    const emailTeams = new Map<string, string[]>()
    for (const u of (users as any[])) {
      const primary   = String(u.properties?.hubspot_team_id         || '').trim()
      const secondary = String(u.properties?.hs_user_secondary_teams || '').trim()
      const teams = [primary, ...secondary.split(';')].map(t => t.trim()).filter(Boolean)
      const matched = teams.filter(t => wanted.has(t))
      if (matched.length && u.properties?.hs_email) {
        emailTeams.set(u.properties.hs_email, Array.from(new Set(matched)))
      }
    }
    if (!emailTeams.size) return []

    // Paginate: /crm/v3/owners caps at 100 per page and this portal has several
    // hundred, so a single page silently missed most of the team.
    const owners: any[] = []
    let ownerAfter: string | undefined = undefined
    for (let page = 0; page < 10; page++) {
      const url = '/crm/v3/owners?limit=100&archived=false' + (ownerAfter ? `&after=${ownerAfter}` : '')
      const ownersRes = await hsProxy('GET', url)
      if (!ownersRes.ok) break // logged by hsProxy
      const body = await ownersRes.json()
      owners.push(...(body.results || []))
      ownerAfter = body.paging?.next?.after
      if (!ownerAfter) break
    }

    return (owners as any[])
      .filter(o => emailTeams.has(o.email))
      .map(o => ({
        id: String(o.id),
        email: o.email,
        name: [o.firstName, o.lastName].filter(Boolean).join(' ') || o.email,
        teamIds: emailTeams.get(o.email) || [],
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch (e) {
    console.error('[hs] fetchOwnersByTeams error:', e)
    return []
  }
}

// ── Leads ─────────────────────────────────────────────────────────────────────
export async function fetchLeads(ownerId: string): Promise<Lead[]> {
  if (isDemo()) return DEMO_LEADS
  if (!ownerId) { console.warn('[hs] fetchLeads called without ownerId'); return [] }
  const res = await hsProxy('POST', '/crm/v3/objects/leads/search', {
    filterGroups: [{
      filters: [
        { propertyName: 'hubspot_owner_id', operator: 'EQ', value: ownerId },
        { propertyName: 'hs_pipeline',       operator: 'EQ', value: CONFIG.PIPELINE_ID },
        { propertyName: 'hs_pipeline_stage', operator: 'EQ', value: CONFIG.STAGES.MQL },
      ],
    }],
    properties: LEAD_PROPS,
    sorts: [{ propertyName: 'screening_call_requested_at', direction: 'DESCENDING' }],
    limit: 100,
  })
  if (!res.ok) throw new Error('fetchLeads HTTP ' + res.status) // detail logged by hsProxy
  return (await res.json()).results || []
}

export async function fetchOneLead(id: string): Promise<Lead | null> {
  if (isDemo()) return null
  try {
    const res = await hsProxy('GET', '/crm/v3/objects/leads/' + id + '?properties=' + LEAD_PROPS.join(','))
    if (!res.ok) return null // logged by hsProxy
    return await res.json() as Lead
  } catch (e) {
    console.error('[hs] fetchOneLead error:', e)
    return null
  }
}

export async function patchLead(
  id: string,
  props: Record<string, string>,
  currentLeads: Lead[],
  updateLeads: (leads: Lead[]) => void,
): Promise<void> {
  if (isDemo()) {
    updateLeads(currentLeads.map(l =>
      l.id === id ? { ...l, properties: { ...l.properties, ...props } } : l
    ))
    return
  }
  return queueForLead(id, async () => {
    const res = await retryProxy('PATCH', '/crm/v3/objects/leads/' + id, { properties: props })
    if (!res.ok) throw new Error('patchLead HTTP ' + res.status) // detail logged by hsProxy
    _notifyWrite(id)
  })
}

export async function requestLeads(rep: { hubspotUserId: string; name: string }): Promise<void> {
  if (isDemo()) { await new Promise(r => setTimeout(r, 700)); return }
  const res = await retryProxy('PATCH', '/crm/v3/objects/users/' + rep.hubspotUserId, {
    properties: { lead_router_trigger: 'true' },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error('requestLeads HTTP ' + res.status + ': ' + _parseHsError(body))
  }
}


// ── Admin team check ──────────────────────────────────────────────────────────
const ADMIN_TEAM_IDS = ['187118858', '187124885']

export async function fetchIsAdmin(userId: string): Promise<boolean> {
  if (isDemo() || !userId) return false
  try {
    const res = await hsProxy('GET',
      `/crm/v3/objects/users/${userId}?properties=hubspot_team_id,hs_user_secondary_teams`)
    if (!res.ok) return false
    const data = await res.json()
    const primary   = (data.properties?.hubspot_team_id          || '').trim()
    const secondary = (data.properties?.hs_user_secondary_teams  || '').trim()
    const allTeams  = [primary, ...secondary.split(';')].map(t => t.trim()).filter(Boolean)
    const isAdm = allTeams.some(t => ADMIN_TEAM_IDS.includes(t))
    console.log('[hs] fetchIsAdmin teams:', allTeams, '→', isAdm)
    return isAdm
  } catch (e) {
    console.error('[hs] fetchIsAdmin error:', e)
    return false
  }
}

// ── Performance ───────────────────────────────────────────────────────────────
export function generateDemoPerf(): PerfData {
  return {
    today: { processed: 8,  sql: 3,  lost: 1  },
    week:  { processed: 35, sql: 12, lost: 5  },
    month: { processed: 142, sql: 48, lost: 21 },
  }
}

/**
 * Fetches leads that exited the MQL stage (hs_v2_date_exited_5404393694 is set)
 * for the given owner, then buckets by exit date into today / week / month.
 * For each bucket: processed = total exited, sql = now in SQL stage, lost = now in Lost stage.
 *
 * HubSpot search paginates at 200 results max per page — we follow `paging.next.after`
 * to collect up to 1 000 records (5 pages), which is plenty for a single rep.
 */
export async function fetchPerformance(ownerId: string): Promise<PerfData> {
  if (isDemo() || !ownerId) return generateDemoPerf()

  const SQL_STAGE  = '5404393697'
  const LOST_STAGE = '5404393698'

  const now      = new Date()
  const todayMs  = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const weekMs   = todayMs - ((now.getDay() || 7) - 1) * 86400000
  const monthMs  = new Date(now.getFullYear(), now.getMonth(), 1).getTime()

  const empty = (): PerfPeriodData => ({ processed: 0, sql: 0, lost: 0 })
  const data: PerfData = { today: empty(), week: empty(), month: empty() }

  // HubSpot timestamps for start-of-month so we can filter server-side
  // (reduces data transferred — still bucket client-side for today/week)
  const monthStart = String(monthMs)

  let after: string | undefined
  let pagesFetched = 0
  const MAX_PAGES = 5

  while (pagesFetched < MAX_PAGES) {
    const body: Record<string, unknown> = {
      filterGroups: [{ filters: [
        { propertyName: 'hubspot_owner_id',              operator: 'EQ',                    value: ownerId },
        { propertyName: 'hs_v2_date_exited_5404393694', operator: 'GTE',                   value: monthStart },
      ]}],
      properties: ['hs_v2_date_exited_5404393694', 'hs_pipeline_stage'],
      limit: 200,
      sorts: [{ propertyName: 'hs_v2_date_exited_5404393694', direction: 'DESCENDING' }],
    }
    if (after) body.after = after

    const res = await hsProxy('POST', '/crm/v3/objects/leads/search', body)
    if (!res.ok) throw new Error('fetchPerformance HTTP ' + res.status)
    const json = await res.json()
    const results: any[] = json.results || []
    pagesFetched++

    for (const lead of results) {
      const exitTs = lead.properties?.hs_v2_date_exited_5404393694
      if (!exitTs) continue
      const exitMs = new Date(exitTs).getTime()
      const stage  = lead.properties?.hs_pipeline_stage || ''
      const isSql  = stage === SQL_STAGE
      const isLost = stage === LOST_STAGE

      const buckets: PerfPeriodData[] = []
      if (exitMs >= monthMs)  buckets.push(data.month)
      if (exitMs >= weekMs)   buckets.push(data.week)
      if (exitMs >= todayMs)  buckets.push(data.today)

      for (const b of buckets) {
        b.processed++
        if (isSql)  b.sql++
        if (isLost) b.lost++
      }
    }

    after = json.paging?.next?.after
    if (!after || results.length < 200) break
  }

  return data
}

// ── Property metadata ─────────────────────────────────────────────────────────
/**
 * Fetch the contact associated with a lead — first/last name, email, phone.
 * Used to prefill the HubSpot meetings scheduler so the rep doesn't have to
 * type the customer's details while on the phone with them.
 *
 * Deliberately on-demand (called when the scheduler opens) rather than part of
 * LEAD_PROPS: it needs an association lookup plus a contact read, which isn't
 * worth doing for every lead on the board when only one is ever scheduled.
 */
export async function fetchLeadContact(leadId: string): Promise<{
  firstName: string; lastName: string; email: string; phone: string
} | null> {
  if (isDemo() || !leadId) return null
  try {
    const assocRes = await hsProxy('GET', `/crm/v4/objects/leads/${leadId}/associations/contacts?limit=1`)
    if (!assocRes.ok) return null // logged by hsProxy
    const assoc = await assocRes.json()
    const contactId = assoc?.results?.[0]?.toObjectId
    if (!contactId) {
      console.warn('[hs] fetchLeadContact: no associated contact for lead', leadId)
      return null
    }
    const res = await hsProxy('GET', `/crm/v3/objects/contacts/${contactId}?properties=firstname,lastname,email,phone`)
    if (!res.ok) return null // logged by hsProxy
    const data = await res.json()
    const pr = data?.properties || {}
    return {
      firstName: pr.firstname || '',
      lastName:  pr.lastname  || '',
      email:     pr.email     || '',
      phone:     pr.phone     || '',
    }
  } catch (e) {
    console.error('[hs] fetchLeadContact error:', leadId, e)
    return null
  }
}

// ── Contact activity timeline ─────────────────────────────────────────────────

export type ActivityKind = 'email' | 'call' | 'note' | 'meeting' | 'marketing'

export interface Activity {
  id: string
  kind: ActivityKind
  /** ISO timestamp, already normalised. */
  at: string
  /** Only shown once the rep opens the row. */
  body: string
  /** Subject, meeting title, or a note's first line. */
  title: string
  /** Inkomend / Uitgaand — derived, since HubSpot's raw values are unreadable. */
  direction: string
  /** Calls only, as 3m12s. */
  duration: string
  /** Raw HubSpot value: email status, call status, or meeting outcome. */
  status: string
  /** Notes only — resolved from the owner id. */
  author: string
}

export type ActivityGroups = Record<ActivityKind, Activity[]>

/**
 * Rows kept per group. This is a recent-history panel, not a substitute for the
 * contact record — anything older is a click away in HubSpot.
 */
export const ACTIVITY_CAP = 7

const EMPTY_GROUPS = (): ActivityGroups =>
  ({ email: [], call: [], note: [], meeting: [], marketing: [] })

interface ActivityCfg {
  kind: ActivityKind
  obj: string
  props: string[]
  map: (p: Record<string, string>) => Partial<Activity> & { at?: string }
}

function _dir(v: string): string {
  const s = (v || '').toUpperCase()
  if (!s) return ''
  // Outgoing email is plain 'EMAIL' while incoming is 'INCOMING_EMAIL', so test
  // for incoming and treat everything else as outgoing.
  return s.includes('INCOMING') || s.includes('INBOUND') ? 'Inkomend' : 'Uitgaand'
}

function _duration(ms: string): string {
  const n = Number(ms)
  if (!n || isNaN(n)) return ''
  const total = Math.round(n / 1000)
  return `${Math.floor(total / 60)}m${String(total % 60).padStart(2, '0')}s`
}

const ACTIVITY_TYPES: ActivityCfg[] = [
  {
    kind: 'email', obj: 'emails',
    props: ['hs_timestamp', 'hs_email_subject', 'hs_email_text', 'hs_email_direction', 'hs_email_status', 'hubspot_owner_id'],
    map: p => ({
      title:     p.hs_email_subject || '(geen onderwerp)',
      body:      stripHtml(p.hs_email_text || ''),
      direction: _dir(p.hs_email_direction),
      status:    p.hs_email_status || '',
      // Whoever on our side sent it, or received it on an incoming reply.
      author:    p.hubspot_owner_id || '',
    }),
  },
  {
    kind: 'call', obj: 'calls',
    // hs_call_disposition is deliberately absent — it comes back as a GUID, not
    // a readable outcome. hs_call_status carries what a rep actually needs.
    props: ['hs_timestamp', 'hs_call_title', 'hs_call_body', 'hs_call_direction', 'hs_call_duration', 'hs_call_status', 'hubspot_owner_id'],
    map: p => ({
      title:     p.hs_call_title || '',
      body:      stripHtml(p.hs_call_body || ''),
      direction: _dir(p.hs_call_direction),
      duration:  _duration(p.hs_call_duration),
      status:    p.hs_call_status || '',
      // Who on our side made the call — resolved to a name in one pass below.
      author:    p.hubspot_owner_id || '',
    }),
  },
  {
    kind: 'note', obj: 'notes',
    props: ['hs_timestamp', 'hs_note_body', 'hubspot_owner_id'],
    map: p => {
      const text = stripHtml(p.hs_note_body || '')
      // Notes carry no subject, so the first line doubles as the headline.
      const first = text.split('\n')[0] || 'Notitie'
      return {
        title:  first.length > 70 ? first.slice(0, 68) + '…' : first,
        body:   text,
        // Resolved to a name later, in one pass, so each note costs no lookup.
        author: p.hubspot_owner_id || '',
      }
    },
  },
  {
    kind: 'meeting', obj: 'meetings',
    props: ['hs_timestamp', 'hs_meeting_title', 'hs_meeting_body', 'hs_meeting_outcome', 'hs_meeting_start_time', 'hubspot_owner_id'],
    map: p => ({
      title:  p.hs_meeting_title || 'Afspraak',
      body:   stripHtml(p.hs_meeting_body || ''),
      // When the meeting is, not when the record was made. Sorting on this also
      // floats an upcoming home visit to the top of the group.
      at:     p.hs_meeting_start_time || undefined,
      status: p.hs_meeting_outcome || '',
      // Whoever on our side owns the meeting.
      author: p.hubspot_owner_id || '',
    }),
  },
]

/**
 * Owner id -> display name, fetched once per page load.
 *
 * Paginated: /crm/v3/owners caps at 100 per page and this portal has several
 * hundred, so a single page silently misses most of them.
 */
let _ownerNames: Map<string, string> | null = null
async function _ownerNameMap(): Promise<Map<string, string>> {
  if (_ownerNames) return _ownerNames
  const map = new Map<string, string>()
  try {
    // Archived owners included on purpose. Activity is history: the person who
    // made a call in July may have left since, and archived=false alone drops
    // them, so the column read "--" for exactly the colleagues a rep is looking
    // up. (fetchOwnersByTeams deliberately keeps archived=false — you should
    // not be able to assign a new task to someone who has left.)
    for (const archived of ['false', 'true']) {
      let after: string | undefined = undefined
      for (let page = 0; page < 10; page++) {
        const url = `/crm/v3/owners?limit=100&archived=${archived}` + (after ? `&after=${after}` : '')
        const res = await retryProxy('GET', url)
        if (!res.ok) break // logged by hsProxy
        const body = await res.json()
        for (const o of (body.results || [])) {
          const name = [o.firstName, o.lastName].filter(Boolean).join(' ') || o.email || ''
          if (o.id && name) map.set(String(o.id), name)
        }
        after = body.paging?.next?.after
        if (!after) break
      }
    }
  } catch (e) {
    console.error('[hs] _ownerNameMap error:', e)
  }
  // Cached even when empty: a failed lookup should not be retried on every
  // lead the rep opens. A reload clears it.
  _ownerNames = map
  return map
}

/**
 * Read one engagement type off a contact.
 *
 * Uses retryProxy: these run on every lead opened, several calls at a time on
 * a token shared by every rep, so 429s are a realistic outcome under load and
 * an un-retried one would blank the group with no explanation.
 *
 * Associations + batch read rather than the search endpoint, even though search
 * would be one call instead of two: HubSpot rate-limits search to 4 requests a
 * second per token, and every rep shares the one private-app token. Four
 * searches per lead opened would sit exactly on that ceiling and start
 * returning 429s as soon as two reps were working at once. Batch reads use the
 * standard, far more generous limit.
 */
async function _activityOfType(contactId: string, cfg: ActivityCfg): Promise<Activity[]> {
  try {
    const assocRes = await retryProxy('GET', `/crm/v4/objects/contacts/${contactId}/associations/${cfg.obj}?limit=100`)
    if (!assocRes.ok) return [] // logged by hsProxy
    const ids = ((await assocRes.json()).results || [])
      .map((r: { toObjectId: string | number }) => String(r.toObjectId))
      .filter(Boolean)
    if (!ids.length) return []

    const readRes = await retryProxy('POST', `/crm/v3/objects/${cfg.obj}/batch/read`, {
      properties: cfg.props,
      inputs: ids.slice(0, 100).map((id: string) => ({ id })),
    })
    if (!readRes.ok) return [] // logged by hsProxy

    return ((await readRes.json()).results || [])
      .map((r: { id: string; properties?: Record<string, string> }) => {
        const p = r.properties || {}
        const m = cfg.map(p)
        const at = _hsMsToIso(m.at ?? p.hs_timestamp)
        if (!at) return null // undated engagements cannot be placed on a timeline
        return {
          id: String(r.id), kind: cfg.kind, at,
          body: m.body || '', title: m.title || '',
          direction: m.direction || '', duration: m.duration || '',
          status: m.status || '', author: m.author || '',
        } as Activity
      })
      .filter(Boolean) as Activity[]
  } catch (e) {
    console.error(`[hs] _activityOfType(${cfg.obj}) error:`, e)
    return []
  }
}

// ── Marketing emails ──────────────────────────────────────────────────────────
// Marketing sends are not `emails` objects — those are 1:1 sales emails only.
// They live in the legacy Email Events API, one row per event, so a single send
// produces SENT, DELIVERED, OPEN, OPEN, CLICK. Collapsed to one row per campaign
// showing the furthest the recipient got.

/** Engagement ladder — a higher rung replaces a lower one. */
const EMAIL_EVENT_RANK: Record<string, number> = { SENT: 1, DELIVERED: 2, OPEN: 3, CLICK: 4 }
/** Outcomes that matter more than engagement and must not be overwritten. */
const EMAIL_EVENT_FAILURES = ['BOUNCE', 'DROPPED', 'SPAMREPORT', 'UNSUBSCRIBED']

/** Campaign id -> name, cached for the page: every lead gets the same nurture. */
const _campaignNames = new Map<string, string>()
async function _campaignName(id: string): Promise<string> {
  const hit = _campaignNames.get(id)
  if (hit !== undefined) return hit
  let name = ''
  try {
    const res = await retryProxy('GET', `/email/public/v1/campaigns/${id}`)
    if (res.ok) {
      const d = await res.json()
      name = d.name || d.subject || ''
    }
  } catch (e) {
    console.error('[hs] _campaignName error:', id, e)
  }
  _campaignNames.set(id, name)
  return name
}

/**
 * Marketing emails sent to a recipient, newest first, one row per campaign.
 *
 * Keyed on the contact's email address rather than an object id — that is what
 * the events API takes, and contact_email already comes with every lead.
 *
 * Needs a marketing scope on the private app. Without it this 403s, which
 * hsProxy logs and this turns into an empty list, so the rest of the timeline
 * is unaffected and the group simply does not appear.
 */
export async function fetchMarketingEmails(recipient: string, limit = ACTIVITY_CAP): Promise<Activity[]> {
  if (isDemo()) return []
  if (!recipient) {
    // Logged loudly: with no address this returns nothing without making a
    // request, which is indistinguishable from "no marketing sent" unless we say so.
    console.warn('[hs] fetchMarketingEmails: no recipient address, skipping')
    return []
  }
  try {
    const res = await retryProxy('GET', `/email/public/v1/events?recipient=${encodeURIComponent(recipient)}&limit=300`)
    if (!res.ok) return [] // logged by hsProxy; usually a missing scope
    const events = ((await res.json()).events || []) as Array<{
      type?: string; created?: number; emailCampaignId?: string | number; subject?: string
    }>

    interface Agg { at: number; status: string; rank: number; subject: string }
    const byCampaign = new Map<string, Agg>()
    for (const ev of events) {
      const cid = String(ev.emailCampaignId || '')
      const type = String(ev.type || '').toUpperCase()
      const created = Number(ev.created || 0)
      if (!cid || !created) continue
      const failed = EMAIL_EVENT_FAILURES.includes(type)
      const rank = failed ? 99 : (EMAIL_EVENT_RANK[type] ?? 0)
      const cur = byCampaign.get(cid)
      if (!cur) {
        byCampaign.set(cid, { at: created, status: type, rank, subject: ev.subject || '' })
        continue
      }
      // The send is the oldest event; engagement comes after it.
      if (created < cur.at) cur.at = created
      if (rank > cur.rank) { cur.rank = rank; cur.status = type }
      if (!cur.subject && ev.subject) cur.subject = ev.subject
    }

    const top = Array.from(byCampaign.entries())
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, limit)

    // Only look a campaign up when the events carried no subject — that keeps
    // this to zero extra calls in the common case.
    return await Promise.all(top.map(async ([cid, agg]) => ({
      id:        'mkt_' + cid,
      kind:      'marketing' as ActivityKind,
      at:        new Date(agg.at).toISOString(),
      body:      '',
      title:     agg.subject || (await _campaignName(cid)) || 'Marketing e-mail',
      direction: '',
      duration:  '',
      status:    agg.status,
      author:    '',
    })))
  } catch (e) {
    console.error('[hs] fetchMarketingEmails error:', e)
    return []
  }
}

/**
 * Recent communication on a lead's contact, grouped by type and newest first
 * within each group.
 *
 * Activities hang off the contact, not the lead — hs_primary_contact_id comes
 * with every lead, so no association lookup is needed to find the person.
 *
 * Each type is fetched independently and a failure yields an empty list for
 * that type only, so one bad response degrades the timeline instead of
 * emptying it.
 */
export async function fetchContactActivity(
  contactId: string,
  contactEmail = '',
  perGroup = ACTIVITY_CAP,
): Promise<ActivityGroups> {
  if (isDemo() || !contactId) return EMPTY_GROUPS()
  // Marketing runs alongside the engagement reads — it is a different API keyed
  // on the email address, and it is skipped entirely when we have no address.
  // Marketing is keyed on the email address, not an object id. contact_email on
  // the lead is not always filled, so fall back to the contact record — one
  // extra call, and only when the lead has no address on it.
  let recipient = contactEmail
  if (!recipient) {
    try {
      const res = await retryProxy('GET', `/crm/v3/objects/contacts/${contactId}?properties=email`)
      if (res.ok) recipient = (await res.json())?.properties?.email || ''
    } catch (e) {
      console.error('[hs] fetchContactActivity: contact email lookup failed:', e)
    }
    console.log('[hs] fetchContactActivity: recipient resolved from contact:', recipient || '(none)')
  }

  // One row past the cap, so the caller can tell "exactly 7" from "7 and more"
  // and say so. The extra row is never rendered.
  const overfetch = perGroup + 1
  const [lists, marketing] = await Promise.all([
    Promise.all(ACTIVITY_TYPES.map(cfg => _activityOfType(contactId, cfg))),
    fetchMarketingEmails(recipient, overfetch),
  ])

  const groups = EMPTY_GROUPS()
  lists.flat().forEach(a => groups[a.kind].push(a))
  marketing.forEach(a => groups.marketing.push(a))
  for (const kind of Object.keys(groups) as ActivityKind[]) {
    groups[kind].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    groups[kind] = groups[kind].slice(0, overfetch)
  }

  // Notes, calls and meetings all name someone on our side. Resolve them in one
  // pass, and only pay for the owners list when there is actually a name to look
  // up — a contact with no such activity costs nothing.
  const attributed: ActivityKind[] = ['note', 'call', 'meeting', 'email']
  if (attributed.some(k => groups[k].some(a => a.author))) {
    const names = await _ownerNameMap()
    for (const k of attributed) {
      groups[k] = groups[k].map(a => ({ ...a, author: a.author ? names.get(a.author) || '' : '' }))
    }
  }
  return groups
}
/**
 * Append the customer's details to a scheduler URL as query params.
 * Verified against HubSpot's public meetings link: firstName / lastName /
 * email / phone all prefill the "Your information" step. The duration step
 * cannot be prefilled (it's buttons, not inputs) — that's fine, the rep picks
 * the slot with the customer anyway.
 * Leaves the URL untouched if there's nothing to add.
 */
export function buildSchedulerUrl(
  baseUrl: string,
  c: { firstName: string; lastName: string; email: string; phone: string } | null,
): string {
  if (!baseUrl || !c) return baseUrl
  try {
    const u = new URL(baseUrl)
    u.searchParams.set('embed', 'true')
    if (c.firstName) u.searchParams.set('firstName', c.firstName)
    if (c.lastName)  u.searchParams.set('lastName',  c.lastName)
    if (c.email)     u.searchParams.set('email',     c.email)
    if (c.phone)     u.searchParams.set('phone',     c.phone)
    return u.toString()
  } catch {
    // Malformed scheduler URL configured in Admin — fall back to it unchanged
    return baseUrl
  }
}

export async function fetchLeadPropertyOptions(
  propName: string,
): Promise<Array<{ label: string; value: string }>> {
  if (isDemo() || !propName) return []
  try {
    const res = await hsProxy('GET', '/crm/v3/properties/leads/' + propName)
    if (!res.ok) return [] // logged by hsProxy
    const data = await res.json()
    const opts = (data.options || []) as Array<{ label: string; value: string; hidden: boolean; displayOrder: number }>
    return opts
      .filter(o => !o.hidden)
      .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
      .map(o => ({ label: o.label, value: o.value }))
  } catch (e) {
    console.error('[hs] fetchLeadPropertyOptions error:', propName, e)
    return []
  }
}

// ── Fetch the deal associated with a lead (created when lead moves to SQL) ────
export interface AssociatedDeal {
  id: string
  name: string
  hvSchedulerUrl: string | null
}

export async function fetchAssociatedDeal(leadId: string): Promise<AssociatedDeal | null> {
  if (isDemo() || !leadId) return null
  try {
    // Primary: v4 associations endpoint
    const assocRes = await hsProxy('GET', `/crm/v4/objects/leads/${leadId}/associations/deals`)
    if (assocRes.ok) {
      const assocData = await assocRes.json()
      const results: Array<{ toObjectId: number | string }> = assocData.results || []
      if (results.length) {
        const dealId = String(results[0].toObjectId)
        const dealRes = await hsProxy('GET',
          `/crm/v3/objects/deals/${dealId}?properties=dealname,home_visit_internal_scheduler_url`)
        if (dealRes.ok) {
          const d = await dealRes.json()
          console.log('[hs] fetchAssociatedDeal found via v4:', dealId, d.properties?.dealname)
          return {
            id: dealId,
            name: d.properties?.dealname || 'Deal',
            hvSchedulerUrl: d.properties?.home_visit_internal_scheduler_url || null,
          }
        }
      }
    } else {
      console.warn('[hs] fetchAssociatedDeal v4 assoc failed:', assocRes.status, '— trying search fallback')
    }

    // Fallback: search deals by associated lead ID
    const searchRes = await hsProxy('POST', '/crm/v3/objects/deals/search', {
      filterGroups: [{ filters: [{ propertyName: 'associations.lead', operator: 'EQ', value: leadId }] }],
      properties: ['dealname', 'home_visit_internal_scheduler_url'],
      sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
      limit: 1,
    })
    if (searchRes.ok) {
      const sd = await searchRes.json()
      const deal = sd.results?.[0]
      if (deal) {
        console.log('[hs] fetchAssociatedDeal found via search:', deal.id, deal.properties?.dealname)
        return {
          id: deal.id,
          name: deal.properties?.dealname || 'Deal',
          hvSchedulerUrl: deal.properties?.home_visit_internal_scheduler_url || null,
        }
      }
    } else {
      console.error('[hs] fetchAssociatedDeal search fallback failed:', searchRes.status)
    }

    return null
  } catch (e) {
    console.error('[hs] fetchAssociatedDeal error:', e)
    return null
  }
}

// ── Fetch HubSpot portal ID (for constructing deal URLs) ─────────────────────
export async function fetchPortalId(): Promise<string | null> {
  try {
    const res = await hsProxy('GET', '/integrations/v1/me')
    if (!res.ok) return null
    const data = await res.json()
    return data.portalId ? String(data.portalId) : null
  } catch (e) {
    console.error('[hs] fetchPortalId error:', e)
    return null
  }
}

export async function fetchAllLeadProperties(): Promise<Array<{ name: string; label: string; type: string; fieldType: string }>> {
  if (isDemo()) return []
  try {
    const res = await hsProxy('GET', '/crm/v3/properties/leads?limit=500')
    if (!res.ok) return [] // logged by hsProxy
    const data = await res.json()
    return ((data.results || []) as any[])
      .filter((p: any) => !p.hidden && p.name && p.label)
      .map((p: any) => ({ name: String(p.name), label: String(p.label), type: String(p.type), fieldType: String(p.fieldType) }))
      .sort((a, b) => a.label.localeCompare(b.label))
  } catch (e) {
    console.error('[hs] fetchAllLeadProperties error:', e)
    return []
  }
}

// ── HubSpot Tasks ─────────────────────────────────────────────────────────────
const TASK_PROPS = ['hs_task_subject', 'hs_task_body', 'hs_timestamp', 'hs_task_status', 'hubspot_owner_id', 'hs_timestamp']

function _encodeLeadInBody(leadId: string | null, notes: string): string {
  return leadId ? `[lead:${leadId}]\n${notes}` : notes
}
function _decodeLeadFromBody(body: string): { leadId: string | null; notes: string } {
  const m = (body || '').match(/^\s*\[lead:([^\]]+)\]\s*/)
  if (m) return { leadId: m[1], notes: body.slice(m[0].length) }
  return { leadId: null, notes: body || '' }
}
/**
 * HubSpot stores task bodies as HTML. Tasks created in the tool are plain text,
 * but anything a rep writes in HubSpot comes back wrapped in divs and paragraphs
 * which would otherwise render as visible markup in the task list.
 * Strips tags, decodes the entities HubSpot actually emits, and collapses the
 * whitespace the tags leave behind.
 */
export function stripHtml(html: string): string {
  if (!html) return ''
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Named and numeric entities beyond the common five — Dutch copy hits
    // accented characters often enough to be worth handling generically.
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&[a-z]+\d*;/gi, m => {
      const el = typeof document !== 'undefined' ? document.createElement('textarea') : null
      if (!el) return m
      el.innerHTML = m
      return el.value
    })
    .replace(/\n{3,}/g, '\n\n')
    .split('\n').map(l => l.trim()).join('\n')
    .trim()
}

/**
 * A due-date input value -> epoch ms.
 *
 * Accepts what datetime-local produces ('YYYY-MM-DDTHH:mm') and a bare
 * 'YYYY-MM-DD'. Both are read as local time: 'YYYY-MM-DD' on its own would be
 * parsed as UTC midnight, which in NL lands the task at 01:00 or 02:00 on the
 * day the rep picked.
 */
function _dateToHsMs(date: string): string | undefined {
  if (!date) return undefined
  const ms = new Date(date.length <= 10 ? date + 'T00:00' : date).getTime()
  if (isNaN(ms)) { console.warn('[hs] _dateToHsMs: invalid date', date); return undefined }
  return String(ms)
}
/**
 * hs_timestamp -> ISO string, or undefined when it is missing or unparseable.
 * Must never throw: toISOString() on an invalid Date raises RangeError, and a
 * single bad timestamp would otherwise take out the whole task list.
 */
function _hsMsToIso(ms: string | undefined): string | undefined {
  if (!ms) return undefined
  // HubSpot returns datetime properties as ISO strings on read (e.g.
  // "2026-09-07T06:00:00Z") but expects epoch ms on write, so handle both.
  const raw = String(ms).trim()
  const d = /^-?\d+$/.test(raw) ? new Date(Number(raw)) : new Date(raw)
  if (isNaN(d.getTime())) return undefined
  return d.toISOString()
}

function _hsMsToDate(ms: string | undefined): string {
  if (!ms) return ''
  return _hsMsToIso(ms)?.slice(0, 10) ?? ''
}

// Known fallback association type ids for this portal, used when the labels
// endpoint is unavailable.
const TASK_ASSOC_FALLBACK: Record<string, number> = { leads: 647, contacts: 204 }

/** The task→<toType> association type for this portal. */
async function _taskAssocType(toType: string): Promise<{ typeId: number; category: string }> {
  const fallback = { typeId: TASK_ASSOC_FALLBACK[toType] ?? 0, category: 'HUBSPOT_DEFINED' }
  const labelsRes = await retryProxy('GET', `/crm/v4/associations/tasks/${toType}/labels`)
  if (!labelsRes.ok) return fallback // logged by hsProxy
  const types: Array<{ typeId: number; label?: string; category?: string }> =
    (await labelsRes.json()).results || []
  if (!types.length) {
    console.warn(`[hs] _taskAssocType(${toType}): no types from API, using fallback`, fallback.typeId)
    return fallback
  }
  // The unlabelled type is the plain HubSpot-defined one; labelled types are
  // extra relationship labels we do not want to pick by accident.
  const t = types.find(x => !x.label) ?? types[0]
  return { typeId: t.typeId, category: t.category ?? 'HUBSPOT_DEFINED' }
}

// Associate a task with a lead via the v4 associations API (best-effort).
async function _linkTaskToLead(taskId: string, leadId: string): Promise<void> {
  try {
    const t = await _taskAssocType('leads')
    const assocRes = await retryProxy(
      'PUT',
      `/crm/v4/objects/tasks/${taskId}/associations/leads/${leadId}`,
      [{ associationCategory: t.category, associationTypeId: t.typeId }],
    )
    if (!assocRes.ok) return // logged by hsProxy
  } catch (e) {
    console.error('[hs] _linkTaskToLead error:', e)
  }
}

/**
 * Repoint a task from one record to another of the same type. Throws, so the
 * caller can tell the rep which link failed.
 *
 * Unlink first, then link. The other order risks leaving the task attached to
 * both records, and fetchTasksForLeads takes the first association it is given
 * — so the task would show under whichever came back first.
 *
 * A failed unlink is only fatal when the association still exists: a 404 means
 * it was already gone, which is the state we wanted anyway.
 */
async function _relinkTaskAssoc(
  taskId: string,
  toType: string,
  prevId: string | null | undefined,
  nextId: string,
): Promise<void> {
  if (prevId && prevId !== nextId) {
    const delRes = await retryProxy('DELETE', `/crm/v4/objects/tasks/${taskId}/associations/${toType}/${prevId}`)
    if (!delRes.ok && delRes.status !== 404) {
      throw new Error(`Could not unlink the previous ${toType} record (HTTP ${delRes.status})`)
    }
  }
  const t = await _taskAssocType(toType)
  const putRes = await retryProxy(
    'PUT',
    `/crm/v4/objects/tasks/${taskId}/associations/${toType}/${nextId}`,
    [{ associationCategory: t.category, associationTypeId: t.typeId }],
  )
  if (!putRes.ok) throw new Error(`Could not link the new ${toType} record (HTTP ${putRes.status})`)
}

/** Create a HubSpot task. Throws with a parsed error message on failure. */
export async function createHsTask(
  title: string,
  notes: string,
  dueDate: string,
  ownerId: string,
  leadId: string | null,
): Promise<string | null> {
  if (isDemo() || !ownerId) return null
  // hs_timestamp = the task's "due date" as shown in HubSpot.
  // hs_task_due_date does not exist in this portal (confirmed by CI).
  // Use the user-selected due date if provided, otherwise default to now.
  const tsMs = _dateToHsMs(dueDate) ?? String(Date.now())
  const props: Record<string, string> = {
    hs_task_subject: title || '(no title)',
    hs_task_body:    _encodeLeadInBody(leadId, notes),
    hs_task_status:  'NOT_STARTED',
    hs_task_type:    'TODO',
    hs_timestamp:    tsMs,
    hubspot_owner_id: ownerId,
  }
  // hsProxy logs the full error body on failure — we just parse and throw for the caller
  const res = await retryProxy('POST', '/crm/v3/objects/tasks', { properties: props })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(_parseHsError(body))
  }
  const data = await res.json()
  const taskId = data.id ? String(data.id) : null
  if (taskId && leadId) await _linkTaskToLead(taskId, leadId)
  return taskId
}

export interface HsTask {
  hsId: string; title: string; notes: string; dueDate: string; leadId: string | null; ownerId: string
  /** Full ISO timestamp of the due date — dueDate loses the time. */
  dueAt?: string
  status?: string
}

export async function fetchHsTasks(ownerId: string): Promise<HsTask[]> {
  if (isDemo() || !ownerId) return []
  try {
    const res = await retryProxy('POST', '/crm/v3/objects/tasks/search', {
      filterGroups: [{
        filters: [
          { propertyName: 'hubspot_owner_id', operator: 'EQ',  value: ownerId },
          { propertyName: 'hs_task_status',   operator: 'NEQ', value: 'COMPLETED' },
        ],
      }],
      properties: TASK_PROPS,
      // hs_timestamp, not hs_task_due_date — the latter does not exist in this
      // portal and sorting on a missing property fails.
      sorts: [{ propertyName: 'hs_timestamp', direction: 'ASCENDING' }],
      limit: 100,
    })
    if (!res.ok) return [] // logged by hsProxy
    const data = await res.json()
    return ((data.results || []) as any[]).map(t => {
      const { leadId, notes } = _decodeLeadFromBody(stripHtml(t.properties?.hs_task_body || ''))
      return { hsId: String(t.id), title: t.properties?.hs_task_subject || '', notes, dueDate: _hsMsToDate(t.properties?.hs_timestamp), leadId, ownerId: t.properties?.hubspot_owner_id || '' } as HsTask
    })
  } catch (e) {
    console.error('[hs] fetchHsTasks error:', e)
    return []
  }
}

/**
 * Fetch the rep's open tasks that belong to one of the given leads.
 *
 * Reads associations in the tasks -> leads direction, because that is the
 * direction the tool creates them in (_linkTaskToLead) and the only one known
 * to be defined in this portal. Reading leads -> tasks came back empty.
 *
 * Two calls regardless of volume: one task search, one batched association
 * read. Tasks not linked to any lead, or linked to a lead outside the given
 * set, are dropped — the list is deliberately scoped to the rep's MQL leads.
 */
export async function fetchTasksForLeads(ownerId: string, leadIds: string[]): Promise<HsTask[]> {
  if (isDemo() || !ownerId || leadIds.length === 0) return []
  const wanted = new Set(leadIds.map(String))
  try {
    // 1 — the rep's open tasks. Sorted on hs_timestamp: hs_task_due_date does
    // not exist in this portal, and sorting on a missing property fails.
    const res = await retryProxy('POST', '/crm/v3/objects/tasks/search', {
      filterGroups: [{
        filters: [
          { propertyName: 'hubspot_owner_id', operator: 'EQ',  value: ownerId },
          { propertyName: 'hs_task_status',   operator: 'NEQ', value: 'COMPLETED' },
        ],
      }],
      properties: ['hs_task_subject', 'hs_task_body', 'hs_timestamp', 'hs_task_status', 'hubspot_owner_id'],
      sorts: [{ propertyName: 'hs_timestamp', direction: 'ASCENDING' }],
      limit: 100,
    })
    if (!res.ok) return [] // logged by hsProxy
    const raw = ((await res.json()).results || []) as any[]
    if (raw.length === 0) return []

    // 2 — which lead each task hangs off
    const assocRes = await retryProxy('POST', '/crm/v4/associations/tasks/leads/batch/read', {
      inputs: raw.map(t => ({ id: String(t.id) })),
    })
    const taskToLead = new Map<string, string>()
    if (assocRes.ok) {
      const assoc = await assocRes.json()
      for (const row of (assoc.results || [])) {
        const taskId = String(row.from?.id || '')
        const first = (row.to || [])[0]
        if (taskId && first) taskToLead.set(taskId, String(first.toObjectId))
      }
    } else {
      console.warn('[hs] fetchTasksForLeads: association read failed, falling back to the [lead:] body marker')
    }

    return raw
      .map(t => {
        // Strip first, then decode: HubSpot wraps task bodies in HTML, so the
        // [lead:xxx] marker is no longer at the start of the raw string.
        const { leadId: bodyLeadId, notes } = _decodeLeadFromBody(stripHtml(t.properties?.hs_task_body || ''))
        // Association is authoritative; the body marker is a fallback for when
        // the association read fails (and only exists on tool-created tasks).
        const leadId = taskToLead.get(String(t.id)) || bodyLeadId
        const ms = t.properties?.hs_timestamp
        return {
          hsId: String(t.id),
          title: t.properties?.hs_task_subject || '',
          notes,
          dueDate: _hsMsToDate(ms),
          dueAt: _hsMsToIso(ms),
          status: t.properties?.hs_task_status || '',
          leadId: leadId || null,
          ownerId: t.properties?.hubspot_owner_id || '',
        } as HsTask
      })
      .filter(t => t.leadId && wanted.has(t.leadId))
      .sort((a, b) => {
        if (!a.dueAt && !b.dueAt) return 0
        if (!a.dueAt) return 1
        if (!b.dueAt) return -1
        return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
      })
  } catch (e) {
    console.error('[hs] fetchTasksForLeads error:', e)
    return []
  }
}

// These three throw on failure. The list is refetched straight afterwards, so
// swallowing an error would leave the rep looking at an unchanged row with no
// idea why.
export async function completeHsTask(hsTaskId: string): Promise<void> {
  if (isDemo() || !hsTaskId) return
  const res = await retryProxy('PATCH', '/crm/v3/objects/tasks/' + hsTaskId, {
    properties: { hs_task_status: 'COMPLETED' },
  })
  if (!res.ok) throw new Error(_parseHsError(await res.text().catch(() => '')))
}

export async function deleteHsTask(hsTaskId: string): Promise<void> {
  if (isDemo() || !hsTaskId) return
  const res = await retryProxy('DELETE', '/crm/v3/objects/tasks/' + hsTaskId)
  if (!res.ok) throw new Error(_parseHsError(await res.text().catch(() => '')))
}

/** What a task is attached to. The contact is the lead's primary contact. */
export interface TaskLinks {
  leadId: string | null
  contactId?: string
}

export interface TaskUpdate {
  title: string
  status: string
  /** Epoch ms. Omitted when the rep left the deadline empty — see below. */
  dueAtMs?: string
  notes: string
  leadId: string
  /** Primary contact of the new lead, so the contact link follows the lead. */
  contactId?: string
}

/**
 * Update the fields a rep can edit from the Tasks tab. Throws on failure.
 *
 * hs_timestamp is left untouched when dueAtMs is missing rather than cleared:
 * it is the task's due date and HubSpot expects one, so clearing it would only
 * fail. An empty deadline field means "leave as is", not "remove".
 */
export async function updateHsTask(
  hsTaskId: string,
  prev: TaskLinks,
  u: TaskUpdate,
): Promise<void> {
  if (isDemo() || !hsTaskId) return
  const props: Record<string, string> = {
    hs_task_subject: u.title || '(no title)',
    hs_task_status:  u.status,
    // Keep the [lead:xxx] marker in step with the association — it is the
    // fallback fetchTasksForLeads uses when the association read fails.
    hs_task_body:    _encodeLeadInBody(u.leadId, u.notes),
  }
  if (u.dueAtMs) props.hs_timestamp = u.dueAtMs

  const res = await retryProxy('PATCH', '/crm/v3/objects/tasks/' + hsTaskId, { properties: props })
  if (!res.ok) throw new Error(_parseHsError(await res.text().catch(() => '')))

  // Associations last: if one fails the properties are already saved, and the
  // error names which link did not stick.
  if (u.leadId !== prev.leadId) {
    await _relinkTaskAssoc(hsTaskId, 'leads', prev.leadId, u.leadId)
    // The contact has to move with the lead. HubSpot attaches the lead's
    // primary contact to the task, but repointing the lead does not detach the
    // old contact — so the task keeps showing on the previous person's record.
    if (u.contactId && u.contactId !== prev.contactId) {
      await _relinkTaskAssoc(hsTaskId, 'contacts', prev.contactId, u.contactId)
    }
  }
}

// ── Aircall CTI ────────────────────────────────────────────────────────────────
export function aircallDial(phone: string): void {
  const clean = phone.replace(/\s/g, '')
  try { window.postMessage({ type: 'callRequest', payload: { phone_number: clean } }, '*') } catch {}
  setTimeout(() => { window.location.href = 'aircallphone://' + clean }, 50)
}

export function initAircallCTI(onIncoming: (leadName: string, phone: string) => void): () => void {
  const handler = (e: MessageEvent) => {
    if (!e.data?.type) return
    if (e.data.type === 'incoming_call') {
      const phone = (e.data.payload?.phone_number || '').replace(/\s/g, '')
      onIncoming(phone, phone)
    }
  }
  window.addEventListener('message', handler)
  return () => window.removeEventListener('message', handler)
}

export function decodeJwt(token: string): Record<string, string> | null {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
  } catch { return null }
}
