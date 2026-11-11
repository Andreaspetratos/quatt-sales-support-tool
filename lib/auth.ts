// Auth token for /api/* calls. Every Pages Function checks it server-side
// (functions/api/_middleware.js), so every call to our own API goes through apiFetch().
//
// After Google sign-in, startSession() swaps the Google ID token (valid 1h) for a
// 12h session token from /api/session. If the server can't mint one (SESSION_SECRET
// not set), it falls back to sending the Google token itself.
// Kept in memory only: a page reload means signing in again, as before.
//
// Only members of the Sales Support / admin HubSpot teams may use the tool
// (lib/access.ts). The server answers 403 with code NO_ACCESS_CODE to anyone
// else, starting with /api/session, and the app then shows the "no access" screen.

import { NO_ACCESS_CODE } from './access'

let token: string | null = null

type Listener = () => void
const _expiredListeners: Listener[] = []
const _deniedListeners: Listener[] = []

function subscribe(list: Listener[], cb: Listener): () => void {
  list.push(cb)
  return () => { const i = list.indexOf(cb); if (i >= 0) list.splice(i, 1) }
}

/** Called when the server rejects our token (401) — the app sends the user back to login. */
export function onAuthExpired(cb: Listener): () => void {
  return subscribe(_expiredListeners, cb)
}

/** Called when the server says this user is not (or no longer) in a Sales Support team. */
export function onAccessDenied(cb: Listener): () => void {
  return subscribe(_deniedListeners, cb)
}

async function isNoAccess(res: Response): Promise<boolean> {
  if (res.status !== 403) return false
  const body = await res.clone().json().catch(() => null)
  return body?.code === NO_ACCESS_CODE
}

export function hasAuthToken(): boolean {
  return token !== null
}

export function clearAuthToken(): void {
  token = null
}

/**
 * Signs in on the server with the Google ID token. The server checks the HubSpot
 * team first, so this is also the access check:
 *   'ok'      — signed in (with a 12h session token, or the Google token if the
 *               server can't mint one)
 *   'denied'  — not in a Sales Support team: show the "no access" screen
 *   'error'   — access couldn't be checked (HubSpot or network down): try again
 */
export async function startSession(googleCredential: string): Promise<'ok' | 'denied' | 'error'> {
  token = null
  try {
    const res = await fetch('/api/session', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + googleCredential },
    })
    if (res.ok) {
      const data = await res.json()
      token = data.token || googleCredential
      return 'ok'
    }
    if (await isNoAccess(res)) return 'denied'
    // 501 = no SESSION_SECRET on this environment; the access check passed before it
    if (res.status === 501) {
      console.warn('[auth] no session token (HTTP 501), using the Google token (valid 1h)')
      token = googleCredential
      return 'ok'
    }
    console.warn('[auth] /api/session HTTP ' + res.status)
    return 'error'
  } catch (e) {
    console.warn('[auth] /api/session failed:', e)
    return 'error'
  }
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', 'Bearer ' + token)
  const res = await fetch(input, { ...init, headers })
  // Only a token we sent can expire; a 401 with no token is just "not signed in yet"
  if (res.status === 401 && token) {
    token = null
    _expiredListeners.forEach(cb => cb())
  }
  // Taken out of the Sales Support team while signed in
  if (token && await isNoAccess(res)) {
    token = null
    _deniedListeners.forEach(cb => cb())
  }
  return res
}
