/**
 * Shared scheduler storage backed by Cloudflare KV.
 * GET  /api/schedulers  → returns current scheduler array as JSON
 * PUT  /api/schedulers  → overwrites scheduler array (admin UI calls this)
 */
export async function onRequest(ctx) {
  const method = ctx.request.method
  const kv = ctx.env.PLAYBOOKS_KV

  if (!kv) {
    console.error('[schedulers] PLAYBOOKS_KV binding not configured')
    return new Response(JSON.stringify({ error: 'KV not configured' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  if (method === 'GET') {
    const val = await kv.get('schedulers')
    console.log(`[schedulers] GET → ${val ? 'found' : 'empty'}`)
    return new Response(val ?? '[]', {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (method === 'PUT') {
    const body = await ctx.request.text()
    try { const s = JSON.parse(body); if (!Array.isArray(s)) throw new Error() }
    catch { return new Response(JSON.stringify({ error: 'Invalid payload' }), { status: 400 }) }
    await kv.put('schedulers', body)
    console.log('[schedulers] PUT → saved')
    return Response.json({ ok: true })
  }

  return new Response('Method not allowed', { status: 405 })
}
