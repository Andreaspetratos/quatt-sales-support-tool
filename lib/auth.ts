// Auth token for /api/* calls. Every Pages Function checks it server-side
// (functions/api/_middleware.js), so every call to our own API goes through apiFetch().
//
// After Google sign-in, startSession() swaps the Google ID token (valid 1h) for a
// 12h session token from /api/session. If the server can't mint one (SESSION_SECRET
// not set), it falls back to sending the Google token itself.
// Kept in memory only: a page reload means signing in again, as before.

let token: string | null = null

type ExpiredListener = () => void
const _expiredListeners: ExpiredListener[] = []

/** Called when the server rejects our token (401) — the app sends the user back to login. */
export function onAuthExpired(cb: ExpiredListener): () => void {
  _expiredListeners.push(cb)
  return () => { const i = _expiredListeners.indexOf(cb); if (i >= 0) _expiredListeners.splice(i, 1) }
}

export function hasAuthToken(): boolean {
  return token !== null
}

export function clearAuthToken(): void {
  token = null
}

export async function startSession(googleCredential: string): Promise<void> {
  token = googleCredential
  try {
    const res = await fetch('/api/session', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + googleCredential },
    })
    if (res.ok) {
      const data = await res.json()
      if (data.token) token = data.token
    } else {
      console.warn('[auth] no session token (HTTP ' + res.status + '), using the Google token (valid 1h)')
    }
  } catch (e) {
    console.warn('[auth] /api/session failed, using the Google token (valid 1h):', e)
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
  return res
}
