import type { Lead } from './types'
import type { PerfData } from './types'
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
]

// ── Demo data ─────────────────────────────────────────────────────────────────
const DEMO_LEADS: Lead[] = [
  { id: '1', properties: { hs_lead_name: 'Lars Haringa',       phone_number: '+31 6 51342788', city: 'Amsterdam',   house_number: '12',  house_number_suffix: 'A',  most_recent_selected_product_lead: 'Hybrid Single, Chill',  qualificationcalloutcome_lead: '--', most_recent_form_origin_lead: 'Configurator',    partner_name_lead: '--', lead_router_qualification_score_lead: '82', screening_call_requested_at: new Date().toISOString(),             hs_pipeline: '3837045967', hs_pipeline_stage: '5404393700' } },
  { id: '2', properties: { hs_lead_name: 'Edwin Kamer',        phone_number: '+31 6 20234646', city: 'Rotterdam',   house_number: '45',  house_number_suffix: '',   most_recent_selected_product_lead: 'Hybrid Single',         qualificationcalloutcome_lead: '--', most_recent_form_origin_lead: 'Savings Check',   partner_name_lead: '--', lead_router_qualification_score_lead: '67', screening_call_requested_at: '',                                   hs_pipeline: '3837045967', hs_pipeline_stage: '5404393694' } },
  { id: '3', properties: { hs_lead_name: 'Jan Verbakel',       phone_number: '+31 6 55111145', city: 'Utrecht',     house_number: '7',   house_number_suffix: 'B',  most_recent_selected_product_lead: 'Hybrid Single, Chill',  qualificationcalloutcome_lead: '--', most_recent_form_origin_lead: 'Configurator',    partner_name_lead: '--', lead_router_qualification_score_lead: '54', screening_call_requested_at: '',                                   hs_pipeline: '3837045967', hs_pipeline_stage: '5404393694' } },
  { id: '4', properties: { hs_lead_name: 'Marcel Van Kesteren',phone_number: '+31 6 51387652', city: 'Den Haag',    house_number: '103', house_number_suffix: '',   most_recent_selected_product_lead: 'Hybrid Duo',            qualificationcalloutcome_lead: '--', most_recent_form_origin_lead: 'Download Brochure',partner_name_lead: '--', lead_router_qualification_score_lead: '41', screening_call_requested_at: new Date(Date.now()-900000).toISOString(),  hs_pipeline: '3837045967', hs_pipeline_stage: '5404393700' } },
  { id: '5', properties: { hs_lead_name: 'I.M. Luddickhuizen', phone_number: '+31 6 13694594', city: 'Eindhoven',   house_number: '22',  house_number_suffix: '',   most_recent_selected_product_lead: 'Hybrid Single',         qualificationcalloutcome_lead: 'No answer',         most_recent_form_origin_lead: 'Partner',         partner_name_lead: 'VEH', lead_router_qualification_score_lead: '30',  screening_call_requested_at: new Date(Date.now()-1800000).toISOString(), hs_pipeline: '3837045967', hs_pipeline_stage: '5404393697' } },
  { id: '6', properties: { hs_lead_name: 'Martin Van der Meirsch',phone_number:'+31 6 14189870',city:'Groningen',  house_number: '8',   house_number_suffix: 'C',  most_recent_selected_product_lead: 'Hybrid Duo',            qualificationcalloutcome_lead: '--', most_recent_form_origin_lead: 'Direct offerte',  partner_name_lead: '--', lead_router_qualification_score_lead: '91', screening_call_requested_at: '',                                   hs_pipeline: '3837045967', hs_pipeline_stage: '5404393694' } },
]

// ── API helpers ───────────────────────────────────────────────────────────────
// All HubSpot traffic routes through the server-side proxy (/api/hs-write)
// so the browser never makes direct authenticated requests to HubSpot (CORS).
async function hsProxy(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch('/api/hs-write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, path, body }),
  })
}

// Retry wrapper — retries on 429 (rate-limited) and 5xx with exponential backoff.
// HubSpot private app: 110 req/10s standard; search: 4 req/s.
async function retryProxy(
  method: string,
  path: string,
  body?: unknown,
  maxAttempts = 3,
): Promise<Response> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      // 1s, 2s, 4s backoff
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)))
    }
    try {
      const res = await hsProxy(method, path, body)
      if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts - 1) continue
      return res
    } catch (e) {
      if (attempt === maxAttempts - 1) throw e
    }
  }
  // unreachable, but TypeScript needs it
  return hsProxy(method, path, body)
}

// Per-lead write queue — ensures writes to the same lead are sequential.
// Prevents race conditions when playbook buttons fire rapidly.
const _leadQueues = new Map<string, Promise<void>>()

function queueForLead(id: string, task: () => Promise<void>): Promise<void> {
  const prev = _leadQueues.get(id) ?? Promise.resolve()
  const execution = prev.then(task)                // propagates errors to caller
  const chain = execution.catch(() => {})          // chain never breaks on error
  _leadQueues.set(id, chain)
  chain.finally(() => { if (_leadQueues.get(id) === chain) _leadQueues.delete(id) })
  return execution
}

// Write success event — components subscribe to trigger post-write re-fetches.
type WriteListener = (leadId: string) => void
const _writeListeners: WriteListener[] = []
export function onLeadWrite(cb: WriteListener): () => void {
  _writeListeners.push(cb)
  return () => { const i = _writeListeners.indexOf(cb); if (i >= 0) _writeListeners.splice(i, 1) }
}
function _notifyWrite(leadId: string): void { _writeListeners.forEach(cb => cb(leadId)) }
// ── Dynamic user ID lookup — called at login so we never rely on hardcoded IDs ─
export async function lookupHubspotUserId(email: string): Promise<string | null> {
  if (isDemo() || !email || !CONFIG.HUBSPOT_TOKEN) return null
  try {
    const res = await hsProxy('POST', '/crm/v3/objects/users/search', {
      filterGroups: [{ filters: [{ propertyName: 'hs_email', operator: 'EQ', value: email }] }],
      properties: ['hs_email'],
      limit: 1,
    })
    console.log('[hubspot] users/search status:', res.status)
    if (!res.ok) { console.warn('[hubspot] users/search failed:', res.status); return null }
    const data = await res.json()
    console.log('[hubspot] users/search result:', JSON.stringify(data).slice(0, 300))
    return data.results?.[0]?.id ?? null
  } catch {
    return null
  }
}

// ── Dynamic owner ID lookup — resolves the CRM owner ID by email ─────────────
// IMPORTANT: Users CRM object ID (hs_object_id) and owners userId are DIFFERENT
// ID systems. The only safe cross-system key is the rep's email address.
// DO NOT use userId from /crm/v3/objects/users to query /crm/v3/owners — it
// returns a random wrong record (confirmed in production debugging).
export async function lookupHubspotOwnerId(email: string): Promise<string | null> {
  if (isDemo() || !email) return null
  try {
    const res = await hsProxy('GET', '/crm/v3/owners?email=' + encodeURIComponent(email) + '&limit=1')
    console.log('[hubspot] owners?email status:', res.status)
    if (!res.ok) { console.warn('[hubspot] owners?email failed:', res.status); return null }
    const data = await res.json()
    console.log('[hubspot] owners?email result:', JSON.stringify(data).slice(0, 200))
    const id = data.results?.[0]?.id
    return id ? String(id) : null
  } catch { return null }
}

// ── Leads ─────────────────────────────────────────────────────────────────────
export async function fetchLeads(ownerId: string): Promise<Lead[]> {
  if (isDemo()) return DEMO_LEADS
  if (!ownerId) return []

  const res = await hsProxy('POST', '/crm/v3/objects/leads/search', {
    filterGroups: [{
      filters: [
        { propertyName: 'hubspot_owner_id', operator: 'EQ', value: ownerId },
        { propertyName: 'hs_pipeline', operator: 'EQ', value: CONFIG.PIPELINE_ID },
        { propertyName: 'hs_pipeline_stage', operator: 'EQ', value: CONFIG.STAGES.MQL },
      ],
    }],
    properties: LEAD_PROPS,
    sorts: [{ propertyName: 'screening_call_requested_at', direction: 'DESCENDING' }],
    limit: 100,
  })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return (await res.json()).results || []
}

// Targeted single-lead refresh — used to confirm state after a write.
export async function fetchOneLead(id: string): Promise<Lead | null> {
  if (isDemo()) return null
  try {
    const res = await hsProxy('GET', '/crm/v3/objects/leads/' + id + '?properties=' + LEAD_PROPS.join(','))
    if (!res.ok) return null
    return await res.json() as Lead
  } catch { return null }
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
    if (!res.ok) throw new Error('HTTP ' + res.status)
    _notifyWrite(id) // triggers post-write re-fetch in PipelineBoard
  })
}

// ── Request leads — sets lead_router_trigger on the rep's HubSpot User ───────
export async function requestLeads(rep: { hubspotUserId: string; name: string }): Promise<void> {
  if (isDemo()) {
    await new Promise(r => setTimeout(r, 700))
    return
  }
  const res = await retryProxy('PATCH', '/crm/v3/objects/users/' + rep.hubspotUserId, {
    properties: { lead_router_trigger: 'true' },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error('HTTP ' + res.status + ': ' + body.slice(0, 200))
  }
}

// ── Performance ───────────────────────────────────────────────────────────────
export function generateDemoPerf(): PerfData {
  const mk = (arr: [string, number][]) => ({ total: arr.reduce((s, x) => s + x[1], 0), outcomes: Object.fromEntries(arr) })
  return {
    today: mk([['Plan HV', 2], ['Plan Call', 3], ['Send brochure (cold lead)', 2], ['Lost', 1]]),
    week:  mk([['Plan HV', 8], ['Plan Call', 12], ['Quote sent', 3], ['On hold due to renovation', 2], ['Send Configurator Link', 4], ['Send brochure (cold lead)', 4], ['Lost', 2]]),
    month: mk([['Plan HV', 28], ['Plan Call', 45], ['Quote sent', 12], ['On hold due to renovation', 7], ['On hold due to district heating', 3], ['Send Configurator Link', 15], ['Send brochure (cold lead)', 18], ['Lost', 14]]),
  }
}

export async function fetchPerformance(ownerId: string): Promise<PerfData> {
  if (isDemo() || !ownerId) return generateDemoPerf()

  const res = await hsProxy('POST', '/crm/v3/objects/leads/search', {
    filterGroups: [{ filters: [
      { propertyName: 'hubspot_owner_id', operator: 'EQ', value: ownerId },
      { propertyName: 'qualificationcalloutcome_lead', operator: 'HAS_PROPERTY' },
    ]}],
    properties: ['qualificationcalloutcome_lead', 'hs_lastmodifieddate'],
    limit: 200,
  })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  const leads = (await res.json()).results || []

  const now = new Date()
  const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const monDelta = (now.getDay() || 7) - 1
  const weekMs = todayMs - monDelta * 86400000
  const monthMs = new Date(now.getFullYear(), now.getMonth(), 1).getTime()

  const empty = () => ({ total: 0, outcomes: {} as Record<string, number> })
  const add = (b: { total: number; outcomes: Record<string, number> }, o: string) => {
    b.total++; b.outcomes[o] = (b.outcomes[o] || 0) + 1
  }
  const data: PerfData = { today: empty(), week: empty(), month: empty() }

  for (const lead of leads) {
    const outcome = (lead.properties?.qualificationcalloutcome_lead || '').trim()
    if (!outcome || outcome === '--') continue
    const mod = new Date(lead.properties?.hs_lastmodifieddate || 0).getTime()
    if (mod >= monthMs) add(data.month, outcome)
    if (mod >= weekMs)  add(data.week, outcome)
    if (mod >= todayMs) add(data.today, outcome)
  }
  return data
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
