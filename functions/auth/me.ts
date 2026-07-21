/**
 * GET /auth/me
 *
 * Returns current session state as JSON.
 * Does NOT redirect — safe to call from client-side JS.
 *
 * Response shapes:
 *   { authenticated: false }
 *   { authenticated: true, email, name, picture, role }
 */

import { parseCookies, verifySession } from '../_lib/session';

interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  SLACK_WEBHOOK_URL?: string;
}

type PagesContext = {
  request: Request;
  env: Env;
  [key: string]: unknown;
};

const NOT_AUTHENTICATED = new Response(
  JSON.stringify({ authenticated: false }),
  {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  },
);

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const { request, env } = context;

  // ------------------------------------------------------------------
  // 1. Read + verify __session cookie
  // ------------------------------------------------------------------
  const cookies = parseCookies(request.headers.get('Cookie'));
  const sessionCookie = cookies['__session'];

  if (!sessionCookie) {
    return NOT_AUTHENTICATED.clone();
  }

  let payload: Record<string, unknown> | null = null;
  try {
    payload = await verifySession(sessionCookie, env.SESSION_SECRET);
  } catch {
    return NOT_AUTHENTICATED.clone();
  }

  if (!payload) {
    return NOT_AUTHENTICATED.clone();
  }

  const email = payload['email'] as string;
  const name = (payload['name'] as string) ?? '';
  const picture = (payload['picture'] as string) ?? '';
  const role = (payload['role'] as string) ?? '';

  // ------------------------------------------------------------------
  // 2. Re-check D1 for revocation + fresh role
  // ------------------------------------------------------------------
  let effectiveRole = role;
  try {
    const row = await env.DB.prepare(
      'SELECT role, revoked_at FROM user_scope WHERE email = ?',
    )
      .bind(email)
      .first<{ role: string; revoked_at: string | null }>();

    if (row?.revoked_at) {
      return NOT_AUTHENTICATED.clone();
    }

    if (row) {
      effectiveRole = row.role;
    }
  } catch {
    // D1 unavailable — use cached role from cookie
  }

  // ------------------------------------------------------------------
  // 3. Return user info
  // ------------------------------------------------------------------
  return new Response(
    JSON.stringify({
      authenticated: true,
      email,
      name,
      picture,
      role: effectiveRole,
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    },
  );
}
