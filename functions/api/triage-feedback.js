/**
 * POST /api/triage-feedback
 * Body: { id, message }
 * Calls Anthropic API to triage the feedback, stores result in KV.
 * Requires ANTHROPIC_API_KEY env var.
 */
export async function onRequestPost(ctx) {
  const kv = ctx.env.PLAYBOOKS_KV
  const apiKey = ctx.env.ANTHROPIC_API_KEY

  if (!apiKey) return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  if (!kv) return new Response(JSON.stringify({ error: 'KV not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } })

  const { id, message } = await ctx.request.json()
  if (!id || !message) return new Response(JSON.stringify({ error: 'id and message required' }), { status: 400 })

  const prompt = `You are triaging feedback for an internal sales support tool used by sales reps at a heat pump company (Quatt). Analyse this feedback submission and respond with a short structured triage in this exact format:

Category: <Bug | Feature Request | UX Issue | Question | Other>
Priority: <High | Medium | Low>
Summary: <1 sentence describing the issue>
Findings: <2-3 sentences with your analysis and recommended action>

Feedback: "${message}"`

  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!aiRes.ok) {
    const err = await aiRes.text()
    console.error('[triage] Anthropic error:', err)
    return new Response(JSON.stringify({ error: 'AI API error' }), { status: 502 })
  }

  const aiData = await aiRes.json()
  const triage = aiData.content?.[0]?.text || 'No response'

  // Persist triage back to KV
  const existing = JSON.parse(await kv.get('feedbacks') ?? '[]')
  const item = existing.find(f => f.id === id)
  if (item) { item.triage = triage; await kv.put('feedbacks', JSON.stringify(existing)) }

  return Response.json({ ok: true, triage })
}
