/**
 * POST /api/hs-write
 * Universal server-side proxy for HubSpot API calls.
 * Bypasses CORS — all HubSpot traffic (reads AND writes) goes through here.
 * Body: { method?: string, path: string, body?: object }
 * method defaults to 'PATCH' for backward compat with existing callers.
 */
export async function onRequestPost(context) {
  try {
    var req = await context.request.json()
    var token = context.env.HUBSPOT_TOKEN || ''

    if (!token) {
      return new Response(JSON.stringify({ error: 'HUBSPOT_TOKEN not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    var method = req.method || 'PATCH'
    var fetchOpts = {
      method: method,
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      }
    }
    if (req.body !== undefined && method !== 'GET') {
      fetchOpts.body = JSON.stringify(req.body)
    }

    var res = await fetch('https://api.hubapi.com' + req.path, fetchOpts)
    var data = await res.text()
    return new Response(data, {
      status: res.status,
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}
