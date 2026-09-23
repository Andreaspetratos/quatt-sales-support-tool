/**
 * Feedback storage backed by Cloudflare KV.
 * GET  /api/feedback  → returns all feedback entries
 * POST /api/feedback  → appends a new feedback entry
 * PATCH /api/feedback → updates triage and/or status of one entry
 */
const STATUSES = ['open', 'in_progress', 'done', 'wont_do']

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
    // Update triage comment and/or status on a specific feedback item — only fields present are changed
    const body = await ctx.request.json()
    if (body.status !== undefined && !STATUSES.includes(body.status)) {
      return new Response(JSON.stringify({ error: 'Invalid status' }), { status: 400 })
    }
    const existing = JSON.parse(await kv.get('feedbacks') ?? '[]')
    const item = existing.find(f => f.id === body.id)
    if (!item) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })
    if (body.triage !== undefined) item.triage = body.triage
    if (body.status !== undefined) {
      item.status = body.status
      item.statusUpdatedAt = new Date().toISOString()
    }
    await kv.put('feedbacks', JSON.stringify(existing))
    return Response.json({ ok: true, item })
  }

  return new Response('Method not allowed', { status: 405 })
}
