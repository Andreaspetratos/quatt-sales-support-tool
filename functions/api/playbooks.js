/**
 * Shared playbook storage backed by Cloudflare KV.
 * GET  /api/playbooks        → returns current playbook array as JSON
 * PUT  /api/playbooks        → overwrites playbook array (admin UI calls this)
 */
export async function onRequest(ctx) {
  const method = ctx.request.method
  const kv = ctx.env.PLAYBOOKS_KV

  if (!kv) {
    console.error('[playbooks] PLAYBOOKS_KV binding not configured')
    return new Response(JSON.stringify({ error: 'KV not configured' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  if (method === 'GET') {
    const val = await kv.get('playbooks')
    console.log(`[playbooks] GET → ${val ? 'found' : 'empty'}`)
    return new Response(val ?? '[]', {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (method === 'PUT') {
    const body = await ctx.request.text()
    // Basic validation — must be a JSON array
    try { const p = JSON.parse(body); if (!Array.isArray(p)) throw new Error() }
    catch { return new Response(JSON.stringify({ error: 'Invalid payload' }), { status: 400 }) }
    await kv.put('playbooks', body)
    console.log('[playbooks] PUT → saved')
    return Response.json({ ok: true })
  }

  return new Response('Method not allowed', { status: 405 })
}
