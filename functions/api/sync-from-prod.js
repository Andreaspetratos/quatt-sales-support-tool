/**
 * Sandbox-only: copy production KV data into the sandbox KV namespace.
 * GET  /api/sync-from-prod → { available: boolean } (true only on sandbox)
 * POST /api/sync-from-prod → overwrites sandbox playbooks/schedulers/feedbacks with production's
 *
 * Data flows one way only: production → sandbox. Production is read over its public
 * GET endpoints — sandbox has no binding to the production KV namespace, so it cannot
 * write there. Refuses unless APP_ENV is explicitly "sandbox" (set in wrangler.toml [env.preview.vars]).
 */
const DATASETS = [
  { key: 'playbooks', path: '/api/playbooks' },
  { key: 'schedulers', path: '/api/schedulers' },
  { key: 'feedbacks', path: '/api/feedback' },
]

export async function onRequest(ctx) {
  const method = ctx.request.method
  const isSandbox = ctx.env.APP_ENV === 'sandbox'
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

  if (method === 'GET') return json({ available: isSandbox && !!ctx.env.PLAYBOOKS_KV && !!ctx.env.PROD_ORIGIN })

  if (method !== 'POST') return new Response('Method not allowed', { status: 405 })
  if (!isSandbox) return json({ error: 'Only available on sandbox' }, 403)

  const kv = ctx.env.PLAYBOOKS_KV
  const origin = ctx.env.PROD_ORIGIN
  if (!kv || !origin) return json({ error: 'KV or PROD_ORIGIN not configured' }, 500)

  // Fetch everything first; only write if every dataset came back as a valid array
  const fetched = []
  for (const d of DATASETS) {
    const res = await fetch(origin + d.path, { method: 'GET' })
    if (!res.ok) return json({ error: `Production ${d.path} returned HTTP ${res.status}` }, 502)
    const text = await res.text()
    let parsed
    try { parsed = JSON.parse(text) } catch { return json({ error: `Production ${d.path} returned invalid JSON` }, 502) }
    if (!Array.isArray(parsed)) return json({ error: `Production ${d.path} did not return an array` }, 502)
    fetched.push({ key: d.key, text, count: parsed.length })
  }

  for (const f of fetched) await kv.put(f.key, f.text)
  console.log('[sync-from-prod] copied', fetched.map(f => `${f.key}=${f.count}`).join(' '))
  return json({ ok: true, counts: Object.fromEntries(fetched.map(f => [f.key, f.count])) })
}
