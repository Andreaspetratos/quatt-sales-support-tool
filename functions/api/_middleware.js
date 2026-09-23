/**
 * Server-side auth for every /api/* Pages Function.
 *
 * Google login happens in the browser, so the server cannot trust anything the
 * browser says about who is signed in. Every request must carry
 *   Authorization: Bearer <token>
 * where <token> is either
 *   - a Google ID token (JWT, RS256) from the login button, or
 *   - a session token this middleware minted from one (POST /api/session).
 * Google ID tokens expire after 1 hour; session tokens last SESSION_TTL_S so reps
 * are not logged out mid-shift. Minting session tokens needs the SESSION_SECRET
 * secret; without it, POST /api/session returns 501 and the frontend keeps using
 * the Google token (so reps have to sign in again after an hour).
 *
 * One exception: /api/sync-from-prod on sandbox reads production's playbooks,
 * schedulers and feedback server-to-server. Those three GETs also accept an
 * X-Sync-Secret header equal to the SYNC_SECRET secret (same value on both
 * environments). Nothing else accepts it.
 *
 * Who may do what (ADMINS lives in lib/access.ts, shared with the frontend):
 *   - any signed-in @quatt.io user: everything not listed below
 *   - admins only: PUT playbooks/schedulers, GET/PATCH/DELETE feedback,
 *     POST triage-feedback, POST sync-from-prod
 * /api/hs-write is further limited to the HubSpot endpoints the tool uses.
 */
import { ADMINS, ALLOWED_DOMAIN, GOOGLE_CLIENT_ID } from '../../lib/access'

const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com']
const CLOCK_SKEW_S = 60
export const SESSION_TTL_S = 12 * 60 * 60

// Requests that X-Sync-Secret may authenticate (method + exact path).
const SYNC_READABLE = new Set(['GET /api/playbooks', 'GET /api/schedulers', 'GET /api/feedback'])

// Requests only admins may make. A '*' method matches every method.
const ADMIN_ONLY = [
  ['PUT', '/api/playbooks'],
  ['PUT', '/api/schedulers'],
  ['GET', '/api/feedback'],
  ['PATCH', '/api/feedback'],
  ['DELETE', '/api/feedback'],
  ['*', '/api/triage-feedback'],
  ['POST', '/api/sync-from-prod'],
]

export async function onRequest(ctx) {
  const { request, env } = ctx
  const url = new URL(request.url)
  const path = url.pathname.replace(/\/+$/, '') || '/'
  const method = request.method

  if (method === 'OPTIONS') return new Response(null, { status: 204 })

  // Server-to-server read from sandbox's /api/sync-from-prod
  const syncHeader = request.headers.get('X-Sync-Secret')
  if (syncHeader !== null) {
    if (SYNC_READABLE.has(`${method} ${path}`) && env.SYNC_SECRET && timingSafeEqual(syncHeader, env.SYNC_SECRET)) {
      ctx.data.user = { email: null, service: 'sync-from-prod', isAdmin: false }
      return ctx.next()
    }
    console.warn(`[auth] ✗ rejected X-Sync-Secret for ${method} ${path}`)
    return deny(401, 'Invalid sync secret')
  }

  const token = bearerToken(request)
  if (!token) return deny(401, 'Not signed in')

  let user
  try {
    user = token.split('.').length === 3
      ? await verifyGoogleIdToken(token)
      : await verifySessionToken(token, env)
  } catch (e) {
    console.warn(`[auth] ✗ ${method} ${path}: ${e.message}`)
    return deny(401, 'Session expired or invalid — please sign in again')
  }
  user.isAdmin = ADMINS.includes(user.email)
  ctx.data.user = user

  // POST /api/session (functions/api/session.js) mints a session token from a Google
  // ID token. Only a Google token may start one, so a session can't renew itself forever.
  if (path === '/api/session' && user.via !== 'google') return deny(400, 'Sign in with Google to start a session')

  if (!user.isAdmin && ADMIN_ONLY.some(([m, p]) => p === path && (m === '*' || m === method))) {
    console.warn(`[auth] ✗ ${user.email} is not an admin: ${method} ${path}`)
    return deny(403, 'Admins only')
  }

  if (path === '/api/hs-write') {
    let req
    try { req = await request.clone().json() } catch { return deny(400, 'Invalid JSON body') }
    const hsMethod = String(req?.method || 'PATCH').toUpperCase()
    if (!isAllowedHubspotCall(hsMethod, req?.path)) {
      console.warn(`[auth] ✗ ${user.email}: HubSpot call not on allowlist: ${hsMethod} ${String(req?.path).slice(0, 200)}`)
      return deny(403, `HubSpot call not allowed: ${hsMethod} ${String(req?.path).split('?')[0].slice(0, 200)}`)
    }
  }

  return ctx.next()
}

// ── HubSpot allowlist ─────────────────────────────────────────────────────────
// Every HubSpot call the frontend makes (lib/hubspot.ts, CreateLeadModal,
// AllLeadsPanel, PipelineBoard, AdminPanel diagnostics). Matched against the
// path without its query string. Adding a new HubSpot call to the tool? Add
// its method + path here too, or the proxy answers 403.
const ID = '[0-9]+'
const HS_ALLOW = {
  GET: [
    `/crm/v3/owners`,
    `/crm/v3/objects/(leads|contacts|deals|users|tasks)/${ID}`,
    `/crm/v4/objects/(leads|contacts)/${ID}/associations/(contacts|deals|emails|calls|notes|meetings|tasks)`,
    `/crm/v4/associations/(tasks|leads)/(leads|contacts)/labels`,
    `/crm/v3/properties/(leads|tasks)`,
    `/crm/v3/properties/leads/[A-Za-z0-9_]+`,
    `/email/public/v1/campaigns/${ID}`,
    `/email/public/v1/events`,
    `/integrations/v1/me`,
    `/communication-preferences/v3/definitions`,
  ],
  POST: [
    `/crm/v3/objects/(leads|contacts|deals|users|tasks)/search`,
    `/crm/v3/objects/(leads|emails|calls|notes|meetings)/batch/read`,
    `/crm/v4/associations/tasks/leads/batch/read`,
    `/crm/v3/objects/(leads|contacts|tasks)`,
    `/communication-preferences/v3/subscribe`,
  ],
  PATCH: [
    `/crm/v3/objects/(leads|contacts|tasks|users)/${ID}`,
  ],
  PUT: [
    `/crm/v4/objects/tasks/${ID}/associations/(leads|contacts)/${ID}`,
  ],
  DELETE: [
    `/crm/v3/objects/tasks/${ID}`,
    `/crm/v4/objects/tasks/${ID}/associations/(leads|contacts)/${ID}`,
  ],
}
const HS_ALLOW_RE = Object.fromEntries(
  Object.entries(HS_ALLOW).map(([m, list]) => [m, list.map(p => new RegExp(`^${p}$`))])
)

export function isAllowedHubspotCall(method, fullPath) {
  // hs-write builds 'https://api.hubapi.com' + path: without the leading '/', a path
  // like '@evil.com/x' would send the HubSpot token to another host.
  if (typeof fullPath !== 'string' || !fullPath.startsWith('/')) return false
  const pathOnly = fullPath.split('?')[0]
  // No dot segments, empty segments or encoded separators that could walk out of the pattern
  if (/[@\\#\s]|\/\/|\.\.|%2e|%2f|%5c/i.test(pathOnly)) return false
  return (HS_ALLOW_RE[method] || []).some(re => re.test(pathOnly))
}

// ── Google ID token ───────────────────────────────────────────────────────────
let certCache = { keys: new Map(), expiresAt: 0, fetchedAt: 0 }

async function googleKey(kid) {
  const now = Date.now()
  const fresh = now < certCache.expiresAt
  if (fresh && certCache.keys.has(kid)) return certCache.keys.get(kid)
  // An unknown kid can mean Google rotated its keys, so refetch — at most once a minute
  if (fresh && now - certCache.fetchedAt < 60_000) throw new Error('Unknown signing key')
  const res = await fetch(GOOGLE_CERTS_URL)
  if (!res.ok) throw new Error(`Could not fetch Google certs (HTTP ${res.status})`)
  const { keys = [] } = await res.json()
  const maxAge = Number((res.headers.get('Cache-Control') || '').match(/max-age=(\d+)/)?.[1] || 3600)
  const map = new Map()
  for (const jwk of keys) {
    if (jwk.kty !== 'RSA' || !jwk.kid) continue
    map.set(jwk.kid, await crypto.subtle.importKey(
      'jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'],
    ))
  }
  certCache = { keys: map, expiresAt: now + maxAge * 1000, fetchedAt: now }
  if (!map.has(kid)) throw new Error('Unknown signing key')
  return map.get(kid)
}

export async function verifyGoogleIdToken(jwt) {
  const [h, p, s] = jwt.split('.')
  const header = JSON.parse(b64urlToString(h))
  if (header.alg !== 'RS256') throw new Error('Unexpected alg ' + header.alg)
  const key = await googleKey(header.kid)
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(s), new TextEncoder().encode(`${h}.${p}`))
  if (!ok) throw new Error('Bad signature')

  const c = JSON.parse(b64urlToString(p))
  const now = Math.floor(Date.now() / 1000)
  if (!GOOGLE_ISSUERS.includes(c.iss)) throw new Error('Bad issuer')
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud]
  if (!aud.includes(GOOGLE_CLIENT_ID)) throw new Error('Bad audience')
  if (typeof c.exp !== 'number' || c.exp + CLOCK_SKEW_S < now) throw new Error('Token expired')
  if (typeof c.iat === 'number' && c.iat - CLOCK_SKEW_S > now) throw new Error('Token issued in the future')
  checkEmail(c.email, c.hd, c.email_verified)
  return { email: c.email.toLowerCase(), name: c.name || c.email, via: 'google', exp: c.exp }
}

function checkEmail(email, hd, verified) {
  if (typeof email !== 'string' || !email.toLowerCase().endsWith('@' + ALLOWED_DOMAIN)) throw new Error('Email not in allowed domain')
  if (hd !== ALLOWED_DOMAIN) throw new Error('Not a ' + ALLOWED_DOMAIN + ' Workspace account')
  if (verified !== true && verified !== 'true') throw new Error('Email not verified')
}

// ── Session token: base64url(payload).base64url(HMAC-SHA256) ──────────────────
async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function signSessionToken(payload, secret) {
  const body = bytesToB64url(new TextEncoder().encode(JSON.stringify({ v: 1, ...payload })))
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(body))
  return `${body}.${bytesToB64url(new Uint8Array(sig))}`
}

export async function verifySessionToken(token, env) {
  if (!env.SESSION_SECRET) throw new Error('Session tokens disabled (no SESSION_SECRET)')
  const [body, sig] = token.split('.')
  if (!body || !sig) throw new Error('Malformed token')
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(env.SESSION_SECRET), b64urlToBytes(sig), new TextEncoder().encode(body))
  if (!ok) throw new Error('Bad session signature')
  const c = JSON.parse(b64urlToString(body))
  if (c.v !== 1) throw new Error('Unknown session version')
  if (typeof c.exp !== 'number' || c.exp < Math.floor(Date.now() / 1000)) throw new Error('Session expired')
  if ((c.env || '') !== (env.APP_ENV || '')) throw new Error('Session belongs to another environment')
  if (typeof c.email !== 'string' || !c.email.endsWith('@' + ALLOWED_DOMAIN)) throw new Error('Email not in allowed domain')
  return { email: c.email, name: c.name || c.email, via: 'session', exp: c.exp }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function bearerToken(request) {
  const m = (request.headers.get('Authorization') || '').match(/^Bearer\s+(\S+)$/i)
  return m ? m[1] : null
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  return Uint8Array.from(atob(b64), ch => ch.charCodeAt(0))
}

function b64urlToString(s) {
  return new TextDecoder().decode(b64urlToBytes(s))
}

function bytesToB64url(bytes) {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}

function deny(status, error) {
  return json({ error }, status)
}
