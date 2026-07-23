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
  if (isDemo() || !email || !CONFIG.HUBSPOT_TOKEN) return null
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
      { propertyName: 'hubspot_owner_id',              operator: 'EQ',           value: ownerId },
      { propertyName: 'qualificationcalloutcome_lead', operator: 'HAS_PROPERTY' },
    ]}],
    properties: ['qualificationcalloutcome_lead', 'hs_lastmodifieddate'],
    limit: 200,
  })
  if (!res.ok) throw new Error('fetchPerformance HTTP ' + res.status)
  const leads = (await res.json()).results || []

  const now = new Date()
  const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const weekMs  = todayMs - ((now.getDay() || 7) - 1) * 86400000
  const monthMs = new Date(now.getFullYear(), now.getMonth(), 1).getTime()

  const empty = () => ({ total: 0, outcomes: {} as Record<string, number> })
  const add = (b: ReturnType<typeof empty>, o: string) => { b.total++; b.outcomes[o] = (b.outcomes[o] || 0) + 1 }
  const data: PerfData = { today: empty(), week: empty(), month: empty() }

  for (const lead of leads) {
    const outcome = (lead.properties?.qualificationcalloutcome_lead || '').trim()
    if (!outcome || outcome === '--') continue
    const mod = new Date(lead.properties?.hs_lastmodifieddate || 0).getTime()
    if (mod >= monthMs) add(data.month, outcome)
    if (mod >= weekMs)  add(data.week,  outcome)
    if (mod >= todayMs) add(data.today, outcome)
  }
  return data
}

// ── Property metadata ─────────────────────────────────────────────────────────
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
const TASK_PROPS = ['hs_task_subject', 'hs_task_body', 'hs_task_due_date', 'hs_task_status', 'hubspot_owner_id', 'hs_timestamp']

function _encodeLeadInBody(leadId: string | null, notes: string): string {
  return leadId ? `[lead:${leadId}]\n${notes}` : notes
}
function _decodeLeadFromBody(body: string): { leadId: string | null; notes: string } {
  const m = (body || '').match(/^\[lead:([^\]]+)\]\n?/)
  if (m) return { leadId: m[1], notes: body.slice(m[0].length) }
  return { leadId: null, notes: body || '' }
}
function _dateToHsMs(date: string): string | undefined {
  if (!date) return undefined
  const ms = new Date(date + 'T00:00:00Z').getTime()
  if (isNaN(ms)) { console.warn('[hs] _dateToHsMs: invalid date', date); return undefined }
  return String(ms)
}
function _hsMsToDate(ms: string | undefined): string {
  if (!ms) return ''
  try { return new Date(Number(ms)).toISOString().slice(0, 10) } catch { return '' }
}

// Associate a task with a lead via the v4 associations API (best-effort).
async function _linkTaskToLead(taskId: string, leadId: string): Promise<void> {
  try {
    const labelsRes = await retryProxy('GET', '/crm/v4/associations/tasks/leads/labels')
    if (!labelsRes.ok) return // logged by hsProxy
    const labelsData = await labelsRes.json()
    // Known fallback: task→lead association type ID is 647 in this portal
    const types: Array<{ typeId: number; label?: string; category?: string }> = labelsData.results || []
    const t = types.find(x => !x.label) ?? types[0] ?? { typeId: 647, category: 'HUBSPOT_DEFINED' }
    if (!types.length) console.warn('[hs] _linkTaskToLead: no types from API, using fallback typeId=647')
    const assocRes = await retryProxy(
      'PUT',
      `/crm/v4/objects/tasks/${taskId}/associations/leads/${leadId}`,
      [{ associationCategory: t.category ?? 'HUBSPOT_DEFINED', associationTypeId: t.typeId }],
    )
    if (!assocRes.ok) return // logged by hsProxy
  } catch (e) {
    console.error('[hs] _linkTaskToLead error:', e)
  }
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
  const props: Record<string, string> = {
    hs_task_subject: title || '(no title)',
    hs_task_body:    _encodeLeadInBody(leadId, notes),
    hs_task_status:  'NOT_STARTED',
    hs_task_type:    'TODO',
    hs_timestamp:    String(Date.now()),   // required by HubSpot tasks API
    hubspot_owner_id: ownerId,
  }
  const ms = _dateToHsMs(dueDate)
  if (ms) props.hs_task_due_date = ms
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
      sorts: [{ propertyName: 'hs_task_due_date', direction: 'ASCENDING' }],
      limit: 100,
    })
    if (!res.ok) return [] // logged by hsProxy
    const data = await res.json()
    return ((data.results || []) as any[]).map(t => {
      const { leadId, notes } = _decodeLeadFromBody(t.properties?.hs_task_body || '')
      return { hsId: String(t.id), title: t.properties?.hs_task_subject || '', notes, dueDate: _hsMsToDate(t.properties?.hs_task_due_date), leadId, ownerId: t.properties?.hubspot_owner_id || '' } as HsTask
    })
  } catch (e) {
    console.error('[hs] fetchHsTasks error:', e)
    return []
  }
}

export async function completeHsTask(hsTaskId: string): Promise<void> {
  if (isDemo() || !hsTaskId) return
  try {
    const res = await retryProxy('PATCH', '/crm/v3/objects/tasks/' + hsTaskId, {
      properties: { hs_task_status: 'COMPLETED' },
    })
    if (!res.ok) return // logged by hsProxy
  } catch (e) {
    console.error('[hs] completeHsTask error:', e)
  }
}

export async function deleteHsTask(hsTaskId: string): Promise<void> {
  if (isDemo() || !hsTaskId) return
  try {
    const res = await retryProxy('DELETE', '/crm/v3/objects/tasks/' + hsTaskId)
    if (!res.ok) return // logged by hsProxy
  } catch (e) {
    console.error('[hs] deleteHsTask error:', e)
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
