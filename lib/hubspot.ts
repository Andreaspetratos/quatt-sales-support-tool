import type { Deal } from './types'
import { CONFIG, isDemo } from './config'

const DEMO_DEALS: Deal[] = [
  { id: '1', properties: { dealname: '[Hybrid] Lars Haringa',     phone: '+31 6 51342788', selected_product: 'Hybrid Single, Chill',       qualification_call_outcome: '--', recent_form_origin: 'Configurator',             partner_name: '--', hubspot_score: '82', lead_temperature: 'hot',  screening_call_requested_at: new Date().toISOString() } },
  { id: '2', properties: { dealname: '[Hybrid] Edwin Kamer',      phone: '+31 6 20234646', selected_product: 'Hybrid Single',              qualification_call_outcome: '--', recent_form_origin: 'Savings Check',            partner_name: '--', hubspot_score: '67', lead_temperature: 'warm', screening_call_requested_at: '' } },
  { id: '3', properties: { dealname: '[Chill FS] Jan Verbakel',   phone: '+31 6 55111145', selected_product: 'Hybrid Single, Chill',       qualification_call_outcome: '--', recent_form_origin: 'Configurator - Cooling',   partner_name: '--', hubspot_score: '54', lead_temperature: 'warm', screening_call_requested_at: '' } },
  { id: '4', properties: { dealname: 'Marcel Van Kesteren',       phone: '+31 6 51387652', selected_product: 'Hybrid Single, Hybrid Duo',  qualification_call_outcome: '--', recent_form_origin: 'Download Hybrid Brochure', partner_name: '--', hubspot_score: '41', lead_temperature: '',     screening_call_requested_at: new Date(Date.now() - 900000).toISOString() } },
  { id: '5', properties: { dealname: '[VEH] I.M. Luddickhuizen',  phone: '+31 6 13694594', selected_product: 'Hybrid Single',              qualification_call_outcome: 'No answer', recent_form_origin: 'Partner',           partner_name: 'VEH', hubspot_score: '30', lead_temperature: 'cold', screening_call_requested_at: new Date(Date.now() - 1800000).toISOString() } },
  { id: '6', properties: { dealname: 'Martin Van der Meirsch',    phone: '+31 6 14189870', selected_product: 'Hybrid Single, Hybrid Duo',  qualification_call_outcome: '--', recent_form_origin: 'Direct offerte - Hybrid', partner_name: '--', hubspot_score: '91', lead_temperature: 'hot',  screening_call_requested_at: '' } },
  { id: '7', properties: { dealname: '[All-E] Sara Pieters',      phone: '+31 6 87234567', selected_product: 'All-Electric',               qualification_call_outcome: '--', recent_form_origin: 'Savings Check',            partner_name: '--', hubspot_score: '74', lead_temperature: 'warm', screening_call_requested_at: new Date(Date.now() - 600000).toISOString() } },
  { id: '8', properties: { dealname: '[HomeBatt] Theo Visser',    phone: '+31 6 65432198', selected_product: 'HomeBattery',                qualification_call_outcome: '--', recent_form_origin: 'Configurator',             partner_name: '--', hubspot_score: '58', lead_temperature: '',     screening_call_requested_at: '' } },
]

const hsUrl = (path: string) => CONFIG.CORS_PROXY + 'https://api.hubapi.com' + path
const hsHeaders = () => ({
  Authorization: 'Bearer ' + CONFIG.HUBSPOT_TOKEN,
  'Content-Type': 'application/json',
})

export async function fetchDeals(ownerId: string): Promise<Deal[]> {
  if (isDemo()) return DEMO_DEALS

  const props = Object.values(CONFIG.PROPS).concat(['dealname', 'dealstage', 'hubspot_owner_id', 'phone'])
  const res = await fetch(hsUrl('/crm/v3/objects/deals/search'), {
    method: 'POST',
    headers: hsHeaders(),
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: 'hubspot_owner_id', operator: 'EQ', value: ownerId }] }],
      properties: Array.from(new Set(props)),
      sorts: [{ propertyName: CONFIG.PROPS.requestedAt, direction: 'DESCENDING' }],
      limit: 100,
    }),
  })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return (await res.json()).results || []
}

export async function patchDeal(
  id: string,
  props: Record<string, string>,
  currentDeals: Deal[],
  updateDeals: (deals: Deal[]) => void,
): Promise<void> {
  if (isDemo()) {
    const updated = currentDeals.map(d =>
      d.id === id ? { ...d, properties: { ...d.properties, ...props } } : d
    )
    updateDeals(updated)
    return
  }
  const res = await fetch(hsUrl('/crm/v3/objects/deals/' + id), {
    method: 'PATCH',
    headers: hsHeaders(),
    body: JSON.stringify({ properties: props }),
  })
  if (!res.ok) throw new Error('HTTP ' + res.status)
}

export async function postWebhook(rep: { hubspotUserId: string; name: string }): Promise<void> {
  if (isDemo()) {
    await new Promise(r => setTimeout(r, 700))
    return
  }
  const res = await fetch(CONFIG.MAKE_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hubspot_user_id: rep.hubspotUserId,
      rep_name: rep.name,
      timestamp: new Date().toISOString(),
    }),
  })
  if (!res.ok) throw new Error('HTTP ' + res.status)
}

// ── Performance data ───────────────────────────────────────────────────────────
import type { PerfData } from './types'

export function generateDemoPerf(): PerfData {
  const mk = (arr: [string, number][]) => ({ total: arr.reduce((s, x) => s + x[1], 0), outcomes: Object.fromEntries(arr) })
  return {
    today: mk([['Plan HV', 2], ['Plan Call', 3], ['Send brochure (cold lead)', 2], ['Lost', 1]]),
    week:  mk([['Plan HV', 8], ['Plan Call', 12], ['Quote sent', 3], ['On hold due to renovation', 2], ['Send Configurator Link', 4], ['Send brochure (cold lead)', 4], ['Lost', 2]]),
    month: mk([['Plan HV', 28], ['Plan Call', 45], ['Quote sent', 12], ['On hold due to renovation', 7], ['On hold due to district heating', 3], ['Send Configurator Link', 15], ['Send brochure (cold lead)', 18], ['Lost', 14]]),
  }
}

export async function fetchPerformance(ownerId: string): Promise<PerfData> {
  if (isDemo()) return generateDemoPerf()

  const res = await fetch(hsUrl('/crm/v3/objects/deals/search'), {
    method: 'POST',
    headers: hsHeaders(),
    body: JSON.stringify({
      filterGroups: [{ filters: [
        { propertyName: 'hubspot_owner_id', operator: 'EQ', value: ownerId },
        { propertyName: 'qualification_call_outcome', operator: 'HAS_PROPERTY' },
      ]}],
      properties: ['qualification_call_outcome', 'hs_lastmodifieddate'],
      limit: 200,
    }),
  })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  const deals = (await res.json()).results || []

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

  for (const deal of deals) {
    const outcome = (deal.properties?.qualification_call_outcome || '').trim()
    if (!outcome || outcome === '--') continue
    const mod = new Date(deal.properties?.hs_lastmodifieddate || 0).getTime()
    if (mod >= monthMs) add(data.month, outcome)
    if (mod >= weekMs) add(data.week, outcome)
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

export function initAircallCTI(onIncoming: (dealName: string, phone: string) => void): () => void {
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

// ── JWT decode ────────────────────────────────────────────────────────────────
export function decodeJwt(token: string): Record<string, string> | null {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return null
  }
}
