/**
 * Feedback storage backed by Cloudflare KV.
 * GET  /api/feedback  → returns all feedback entries
 * POST /api/feedback  → appends a new feedback entry
 */
export async function onRequest(ctx) {
  const method = ctx.request.method
  const kv = ctx.env.PLAYBOOKS_KV

  if (!kv) return new Response(JSON.stringify({ error: 'KV not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } })

  if (method === 'GET') {
    const val = await kv.get('feedbacks')
    return new Response(val ?? '[]', { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
  }

  if (method === 'POST') {
    const body = await ctx.request.json()
    if (!body.message || !body.submittedBy) return new Response(JSON.stringify({ error: 'Invalid payload' }), { status: 400 })
    const existing = JSON.parse(await kv.get('feedbacks') ?? '[]')
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      message: String(body.message).slice(0, 2000),
      submittedBy: String(body.submittedBy),
      submittedAt: new Date().toISOString(),
      triage: null,
    }
    existing.unshift(entry)
    await kv.put('feedbacks', JSON.stringify(existing))
    return Response.json({ ok: true, id: entry.id })
  }

  if (method === 'PATCH') {
    // Update triage comment on a specific feedback item
    const { id, triage } = await ctx.request.json()
    const existing = JSON.parse(await kv.get('feedbacks') ?? '[]')
    const item = existing.find(f => f.id === id)
    if (!item) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })
    item.triage = triage
    await kv.put('feedbacks', JSON.stringify(existing))
    return Response.json({ ok: true })
  }

  return new Response('Method not allowed', { status: 405 })
}
