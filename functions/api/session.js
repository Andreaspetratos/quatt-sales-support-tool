/**
 * POST /api/session
 * Header: Authorization: Bearer <Google ID token>
 * → { token, exp, email, isAdmin }
 *
 * Exchanges the 1-hour Google ID token for a session token that lasts
 * SESSION_TTL_S (12h), so reps are not signed out mid-shift. The Google token
 * is verified by _middleware.js before this runs; it also refuses to mint from
 * an existing session token. Needs the SESSION_SECRET secret (set per
 * environment in the Cloudflare dashboard); without it this answers 501 and
 * the frontend keeps sending the Google token.
 */
import { signSessionToken, SESSION_TTL_S } from './_middleware'

export async function onRequestPost(ctx) {
  const user = ctx.data.user
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
  if (!ctx.env.SESSION_SECRET) return json({ error: 'SESSION_SECRET not configured' }, 501)
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_S
  const token = await signSessionToken({ email: user.email, name: user.name, env: ctx.env.APP_ENV || '', exp }, ctx.env.SESSION_SECRET)
  console.log(`[auth] session started for ${user.email}`)
  return json({ token, exp, email: user.email, isAdmin: user.isAdmin })
}
