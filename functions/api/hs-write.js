/**
 * POST /api/hs-write
 * Server-side proxy for HubSpot PATCH calls (browsers can't PATCH due to CORS).
 * Body: { path: string, body: object }
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

    var res = await fetch('https://api.hubapi.com' + req.path, {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(req.body)
    })

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
