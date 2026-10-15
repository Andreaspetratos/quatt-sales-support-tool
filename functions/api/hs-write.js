/**
 * POST /api/hs-write
 * Universal server-side proxy for HubSpot API calls.
 * Body: { method?: string, path: string, body?: object }
 * method defaults to 'PATCH' for backward compat with existing callers.
 *
 * Callers must be signed in, and only HubSpot endpoints on the allowlist in
 * _middleware.js get through — see there.
 *
 * All requests and errors are logged here (visible in Cloudflare dashboard → Functions → Logs).
 * The browser-side hsProxy() in lib/hubspot.ts also logs all non-2xx responses to the console.
 */

// Lead properties other systems write too, which the tool may only add to: the
// configurator and the self-service quote put the customer's quote in
// personal_info__notes_lead. The browser appends to the current value
// (appendLeadText), but a tab still running a build from before that fix sends
// only the new notes and wipes the quote. Every tab's request passes through
// this proxy, so the rule is enforced here as well.
const APPEND_ONLY_LEAD_PROPS = ['personal_info__notes_lead']
const LEAD_PATCH_RE = /^\/crm\/v3\/objects\/leads\/(\d+)$/

// What to write so that nothing already in HubSpot is lost.
export function keepExisting(current, next) {
  const cur = String(current || '').trim()
  const nxt = String(next || '').trim()
  if (!cur || nxt.startsWith(cur)) return next
  if (cur.includes(nxt)) return cur // nothing new
  // An older tab appends to its own copy, which may hold only the tool's earlier
  // notes from this session: keep HubSpot's value and add the part it lacks.
  for (let k = Math.min(cur.length, nxt.length - 1); k > 0; k--) {
    if (nxt[k] === '\n' && cur.endsWith(nxt.slice(0, k))) return cur + nxt.slice(k)
  }
  return `${cur}\n\n${nxt}`
}

async function protectAppendOnly(path, props, headers, who) {
  const m = LEAD_PATCH_RE.exec(path.split('?')[0])
  if (!m || !props || typeof props !== 'object') return props
  const names = APPEND_ONLY_LEAD_PROPS.filter(p => typeof props[p] === 'string')
  if (names.length === 0) return props
  const res = await fetch(`https://api.hubapi.com/crm/v3/objects/leads/${m[1]}?properties=${names.join(',')}`, { headers })
  if (!res.ok) throw new Error(`could not read ${names.join(',')} before writing (HTTP ${res.status})`)
  const current = (await res.json())?.properties || {}
  const out = { ...props }
  for (const p of names) {
    out[p] = keepExisting(current[p], props[p])
    if (out[p] !== props[p]) console.warn(`[proxy] kept existing ${p} on lead ${m[1]} (${who})`)
  }
  return out
}

export async function onRequestPost(context) {
  try {
    const req = await context.request.json()
    const token = context.env.HUBSPOT_TOKEN_PROD || context.env.HUBSPOT_TOKEN || ''

    if (!token) {
      console.error('[proxy] HUBSPOT_TOKEN is not set')
      return new Response(JSON.stringify({ error: 'HUBSPOT_TOKEN not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const method = String(req.method || 'PATCH').toUpperCase()
    const url = new URL('https://api.hubapi.com' + req.path)
    if (url.origin !== 'https://api.hubapi.com') {
      return new Response(JSON.stringify({ error: 'Invalid path' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
    const who = context.data.user?.email || '?'

    const fetchOpts = {
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
    }
    if (req.body !== undefined && method !== 'GET' && method !== 'DELETE') {
      let body = req.body
      if (method === 'PATCH' && body?.properties) {
        try {
          body = { ...body, properties: await protectAppendOnly(req.path, body.properties, fetchOpts.headers, who) }
        } catch (e) {
          // Refuse rather than risk overwriting what other systems wrote
          console.error(`[proxy] ✗ ${method} ${req.path}: ${e.message}`)
          return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: { 'Content-Type': 'application/json' } })
        }
      }
      fetchOpts.body = JSON.stringify(body)
    }

    console.log(`[proxy] → ${method} ${req.path} (${who})`)

    const hsRes = await fetch(url, fetchOpts)
    const data = await hsRes.text()

    if (!hsRes.ok) {
      // Log full error body at the edge — visible in Cloudflare Functions logs
      console.error(`[proxy] ✗ ${method} ${req.path} → ${hsRes.status}:`, data.slice(0, 1000))
    } else {
      console.log(`[proxy] ✓ ${method} ${req.path} → ${hsRes.status}`)
    }

    return new Response(data, {
      status: hsRes.status,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    console.error('[proxy] unexpected error:', String(e))
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
