/**
 * GET /auth/logout
 *
 * Clears session and refresh cookies, writes an access_log row,
 * then redirects to /auth/login.
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
  waitUntil: (promise: Promise<unknown>) => void;
  [key: string]: unknown;
};

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const { request, env } = context;

  // Attempt to identify who is logging out for the access_log
  let email: string | null = null;
  let role: string | null = null;

  const cookies = parseCookies(request.headers.get('Cookie'));
  const sessionCookie = cookies['__session'];

  if (sessionCookie) {
    try {
      const payload = await verifySession(sessionCookie, env.SESSION_SECRET);
      if (payload) {
        email = (payload['email'] as string) ?? null;
        role = (payload['role'] as string) ?? null;
      }
    } catch {
      // Ignore — we're logging out regardless
    }
  }

  // Write access_log row (fire-and-forget)
  const ip =
    request.headers.get('CF-Connecting-IP') ??
    request.headers.get('X-Forwarded-For') ??
    '';
  const userAgent = request.headers.get('User-Agent') ?? '';

  context.waitUntil(
    env.DB.prepare(
      `INSERT INTO access_log (email, role, action, ip, user_agent, result)
       VALUES (?, ?, 'signout', ?, ?, 'ok')`,
    )
      .bind(email, role, ip, userAgent)
      .run()
      .catch((err) => console.error('[logout] access_log insert failed', err)),
  );

  // Clear cookies and redirect
  const headers = new Headers({
    Location: '/auth/login',
    'Cache-Control': 'no-store',
  });

  headers.append(
    'Set-Cookie',
    '__session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
  );
  headers.append(
    'Set-Cookie',
    '__refresh=; HttpOnly; Secure; SameSite=Lax; Path=/auth/; Max-Age=0',
  );

  return new Response(null, { status: 302, headers });
}
