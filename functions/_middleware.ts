/**
 * Cloudflare Pages middleware — applied to every request.
 *
 * Flow:
 *  1. Skip /auth/* paths (handled by auth functions).
 *  2. Read __session cookie; redirect to /auth/login if missing.
 *  3. HMAC-verify and decode the session payload.
 *  4. Reject expired sessions.
 *  5. Re-check D1 user_scope for revocation.
 *  6. Write an access_log row.
 *  7. Forward X-User-* headers to the static file handler.
 */

import { parseCookies, verifySession } from './_lib/session';

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
  next: () => Promise<Response>;
  waitUntil: (promise: Promise<unknown>) => void;
  [key: string]: unknown;
};

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const pathname = url.pathname;

  // ------------------------------------------------------------------
  // 1. Skip auth routes — they handle themselves
  // ------------------------------------------------------------------
  if (pathname.startsWith('/auth/')) {
    return context.next();
  }

  // ------------------------------------------------------------------
  // 2. Read __session cookie
  // ------------------------------------------------------------------
  const cookies = parseCookies(request.headers.get('Cookie'));
  const sessionCookie = cookies['__session'];

  const loginRedirect = (reason?: string) => {
    const next = encodeURIComponent(pathname + url.search);
    const dest = `/auth/login?next=${next}${reason ? `&reason=${reason}` : ''}`;
    return Response.redirect(new URL(dest, url.origin).toString(), 302);
  };

  if (!sessionCookie) {
    return loginRedirect();
  }

  // ------------------------------------------------------------------
  // 3 & 4. HMAC verify + expiry check (verifySession returns null on failure)
  // ------------------------------------------------------------------
  let payload: Record<string, unknown> | null = null;
  try {
    payload = await verifySession(sessionCookie, env.SESSION_SECRET);
  } catch {
    return loginRedirect();
  }

  if (!payload) {
    // Invalid signature or expired
    const headers = new Headers({ Location: `/auth/login?next=${encodeURIComponent(pathname + url.search)}` });
    headers.append(
      'Set-Cookie',
      '__session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
    );
    return new Response(null, { status: 302, headers });
  }

  const email = payload['email'] as string;
  const name = (payload['name'] as string) ?? '';
  const role = (payload['role'] as string) ?? '';

  // ------------------------------------------------------------------
  // 5. Re-check D1 for revocation
  // ------------------------------------------------------------------
  let userRow: { revoked_at: string | null; role: string } | null = null;
  try {
    userRow = await env.DB.prepare(
      'SELECT role, revoked_at FROM user_scope WHERE email = ?',
    )
      .bind(email)
      .first<{ role: string; revoked_at: string | null }>();
  } catch {
    // D1 unavailable — fail open (log only), do not block the request
    console.error('[middleware] D1 query failed, failing open');
  }

  if (userRow?.revoked_at) {
    // Account revoked — clear cookie and bounce to login
    const headers = new Headers({
      Location: `/auth/login?reason=revoked`,
    });
    headers.append(
      'Set-Cookie',
      '__session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
    );
    return new Response(null, { status: 302, headers });
  }

  // Use the freshest role from D1 if available
  const effectiveRole = userRow?.role ?? role;

  // ------------------------------------------------------------------
  // 6. Write access_log row (fire-and-forget)
  // ------------------------------------------------------------------
  const ip =
    request.headers.get('CF-Connecting-IP') ??
    request.headers.get('X-Forwarded-For') ??
    '';
  const userAgent = request.headers.get('User-Agent') ?? '';

  context.waitUntil(
    env.DB.prepare(
      `INSERT INTO access_log (email, role, action, ip, user_agent, result)
       VALUES (?, ?, 'view', ?, ?, 'ok')`,
    )
      .bind(email, effectiveRole, ip, userAgent)
      .run()
      .catch((err) => console.error('[middleware] access_log insert failed', err)),
  );

  // ------------------------------------------------------------------
  // 7. Forward user headers to downstream (static file / SSR)
  // ------------------------------------------------------------------
  const modifiedRequest = new Request(request, {
    headers: (() => {
      const h = new Headers(request.headers);
      h.set('X-User-Email', email);
      h.set('X-User-Role', effectiveRole);
      h.set('X-User-Name', name);
      return h;
    })(),
  });

  // Replace request in context for next handler
  (context as Record<string, unknown>)['request'] = modifiedRequest;

  return context.next();
}
