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
      fetchOpts.body = JSON.stringify(req.body)
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
