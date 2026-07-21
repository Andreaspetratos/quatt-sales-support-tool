/**
 * GET /auth/callback
 *
 * Google OAuth 2.0 callback handler.
 *
 * Steps:
 *  1. Read code + state from query params.
 *  2. Verify state against __oauth_state cookie.
 *  3. Exchange code for tokens (PKCE).
 *  4. Verify id_token JWT via Google JWKS.
 *  5. Enforce @quatt.io domain via hd claim.
 *  6. Upsert user_scope in D1; send Slack alert on first sign-in.
 *  7. Mint __session (1h) and __refresh (24h) cookies.
 *  8. Clear __oauth_state cookie.
 *  9. Redirect to original destination.
 */

import { signPayload } from '../_lib/session';

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

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

function uint8ToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function base64UrlToUint8(b64: string): Uint8Array {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/');
  const padding = (4 - (padded.length % 4)) % 4;
  const std = padded + '='.repeat(padding);
  const binary = atob(std);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(';').map((pair) => {
      const idx = pair.indexOf('=');
      if (idx === -1) return [pair.trim(), ''];
      return [pair.slice(0, idx).trim(), pair.slice(idx + 1).trim()];
    }),
  );
}

// ---------------------------------------------------------------------------
// Google JWKS verification
// ---------------------------------------------------------------------------

interface JwkKey {
  kid: string;
  n: string;
  e: string;
  kty: string;
  alg: string;
  use: string;
}

interface GoogleJwks {
  keys: JwkKey[];
}

interface IdTokenPayload {
  iss: string;
  aud: string;
  exp: number;
  iat: number;
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
  picture: string;
  hd?: string;
}

async function verifyIdToken(
  idToken: string,
  clientId: string,
): Promise<IdTokenPayload> {
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }
  const [headerB64, payloadB64, signatureB64] = parts;

  // Decode header to get kid
  const headerJson = new TextDecoder().decode(base64UrlToUint8(headerB64));
  const header = JSON.parse(headerJson) as { kid: string; alg: string };

  // Fetch Google JWKS
  const jwksRes = await fetch('https://www.googleapis.com/oauth2/v3/certs', {
    cf: { cacheTtl: 3600, cacheEverything: true } as RequestInitCfProperties,
  });
  if (!jwksRes.ok) {
    throw new Error(`Failed to fetch JWKS: ${jwksRes.status}`);
  }
  const jwks = (await jwksRes.json()) as GoogleJwks;

  // Find matching key by kid
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    throw new Error(`No matching JWK found for kid: ${header.kid}`);
  }

  // Import the public key
  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  // Verify signature: data is the UTF-8 encoding of "header.payload"
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlToUint8(signatureB64);

  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    signature,
    data,
  );

  if (!valid) {
    throw new Error('JWT signature verification failed');
  }

  // Decode payload
  const payloadJson = new TextDecoder().decode(base64UrlToUint8(payloadB64));
  const payload = JSON.parse(payloadJson) as IdTokenPayload;

  // Validate standard claims
  if (payload.iss !== 'https://accounts.google.com') {
    throw new Error(`Invalid issuer: ${payload.iss}`);
  }
  if (payload.aud !== clientId) {
    throw new Error(`Invalid audience: ${payload.aud}`);
  }
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) {
    throw new Error('id_token is expired');
  }

  return payload;
}

// ---------------------------------------------------------------------------
// Error response helper
// ---------------------------------------------------------------------------

function errorResponse(status: number, title: string, body: string): Response {
  return new Response(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; align-items: center;
           justify-content: center; min-height: 100vh; margin: 0; background: #f9fafb; }
    .card { background: #fff; border-radius: 12px; padding: 2rem 2.5rem;
            box-shadow: 0 4px 24px rgba(0,0,0,.08); max-width: 420px; text-align: center; }
    h1 { color: #111827; font-size: 1.5rem; margin-bottom: .5rem; }
    p  { color: #6b7280; line-height: 1.6; }
    a  { color: #2563eb; text-decoration: none; font-weight: 500; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${body}</p>
  </div>
</body>
</html>`,
    {
      status,
      headers: { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': 'no-store' },
    },
  );
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const origin = url.origin;

  // ------------------------------------------------------------------
  // 1. Read code + state from query params
  // ------------------------------------------------------------------
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');

  if (errorParam) {
    return errorResponse(
      400,
      'Sign-in cancelled',
      `Google returned an error: <strong>${errorParam}</strong>. <a href="/auth/login">Try again</a>`,
    );
  }

  if (!code || !stateParam) {
    return errorResponse(400, 'Bad request', 'Missing code or state parameter. <a href="/auth/login">Try again</a>');
  }

  // ------------------------------------------------------------------
  // 2. Verify state against __oauth_state cookie
  // ------------------------------------------------------------------
  const cookies = parseCookies(request.headers.get('Cookie'));
  const rawStateCookie = cookies['__oauth_state'];

  if (!rawStateCookie) {
    return errorResponse(400, 'Session expired', 'The OAuth state cookie is missing or expired. <a href="/auth/login">Try again</a>');
  }

  let stateData: { state: string; codeVerifier: string; next: string };
  try {
    stateData = JSON.parse(atob(rawStateCookie)) as typeof stateData;
  } catch {
    return errorResponse(400, 'Invalid state', 'Could not parse OAuth state. <a href="/auth/login">Try again</a>');
  }

  if (stateData.state !== stateParam) {
    return errorResponse(403, 'State mismatch', 'CSRF check failed. <a href="/auth/login">Try again</a>');
  }

  const { codeVerifier, next } = stateData;

  // ------------------------------------------------------------------
  // 3. Exchange code for tokens
  // ------------------------------------------------------------------
  const redirectUri = `${origin}/auth/callback`;

  let tokenData: {
    access_token: string;
    id_token: string;
    refresh_token?: string;
    error?: string;
  };

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        code,
        code_verifier: codeVerifier,
      }).toString(),
    });

    tokenData = (await tokenRes.json()) as typeof tokenData;

    if (tokenData.error) {
      console.error('[callback] token exchange error', tokenData);
      return errorResponse(502, 'Token exchange failed', `Google returned: <strong>${tokenData.error}</strong>. <a href="/auth/login">Try again</a>`);
    }
  } catch (err) {
    console.error('[callback] token exchange fetch failed', err);
    return errorResponse(502, 'Network error', 'Could not reach Google to exchange the authorization code. <a href="/auth/login">Try again</a>');
  }

  // ------------------------------------------------------------------
  // 4. Verify id_token JWT via Google JWKS
  // ------------------------------------------------------------------
  let idPayload: IdTokenPayload;
  try {
    idPayload = await verifyIdToken(tokenData.id_token, env.GOOGLE_CLIENT_ID);
  } catch (err) {
    console.error('[callback] id_token verification failed', err);
    return errorResponse(502, 'Token verification failed', 'Could not verify your Google identity token. <a href="/auth/login">Try again</a>');
  }

  const { email, name, picture, hd } = idPayload;

  // ------------------------------------------------------------------
  // 5. Enforce @quatt.io domain
  // ------------------------------------------------------------------
  if (hd !== 'quatt.io') {
    return errorResponse(
      403,
      'Access restricted',
      `This application is restricted to <strong>@quatt.io</strong> accounts. You signed in as <strong>${email}</strong>. <a href="/auth/login">Try again</a>`,
    );
  }

  // ------------------------------------------------------------------
  // 6. Upsert user_scope; send Slack alert on first sign-in
  // ------------------------------------------------------------------
  const now = new Date().toISOString();
  let isNewUser = false;
  let userRole = 'pending';

  try {
    const existing = await env.DB.prepare(
      'SELECT role, revoked_at FROM user_scope WHERE email = ?',
    )
      .bind(email)
      .first<{ role: string; revoked_at: string | null }>();

    if (existing) {
      // Update last_seen_at
      await env.DB.prepare(
        "UPDATE user_scope SET last_seen_at = ? WHERE email = ?",
      )
        .bind(now, email)
        .run();
      userRole = existing.role;

      if (existing.revoked_at) {
        return errorResponse(
          403,
          'Account revoked',
          'Your access has been revoked. Contact your administrator. <a href="/auth/login">Try again</a>',
        );
      }
    } else {
      // First sign-in — insert with role=pending
      await env.DB.prepare(
        `INSERT INTO user_scope (email, role, added_at, added_by, last_seen_at)
         VALUES (?, 'pending', ?, 'google-oauth-auto', ?)`,
      )
        .bind(email, now, now)
        .run();
      isNewUser = true;
      userRole = 'pending';
    }
  } catch (err) {
    console.error('[callback] D1 upsert failed', err);
    // Non-fatal — continue with role=pending
  }

  // Slack alert on first sign-in
  if (isNewUser && env.SLACK_WEBHOOK_URL) {
    context.waitUntil(
      fetch(env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `:wave: New user signed in for the first time: *${name}* (${email}). Role set to \`pending\` — <${origin}/admin|review access>.`,
        }),
      }).catch((err) => console.error('[callback] Slack webhook failed', err)),
    );
  }

  // ------------------------------------------------------------------
  // 7. Mint __session and __refresh cookies
  // ------------------------------------------------------------------
  const nowSec = Math.floor(Date.now() / 1000);

  const sessionPayload = {
    email,
    name,
    picture,
    role: userRole,
    iat: nowSec,
    exp: nowSec + 3600, // 1 hour
  };

  const refreshPayload = {
    email,
    exp: nowSec + 86400, // 24 hours
  };

  const [sessionCookieValue, refreshCookieValue] = await Promise.all([
    signPayload(sessionPayload, env.SESSION_SECRET),
    signPayload(refreshPayload, env.SESSION_SECRET),
  ]);

  const sessionCookie = [
    `__session=${sessionCookieValue}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Path=/',
    'Max-Age=3600',
  ].join('; ');

  const refreshCookie = [
    `__refresh=${refreshCookieValue}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Path=/auth/',
    'Max-Age=86400',
  ].join('; ');

  // ------------------------------------------------------------------
  // 8. Clear __oauth_state cookie
  // ------------------------------------------------------------------
  const clearStateCookie =
    '__oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';

  // ------------------------------------------------------------------
  // 11. Write access_log (fire-and-forget)
  // ------------------------------------------------------------------
  const ip =
    request.headers.get('CF-Connecting-IP') ??
    request.headers.get('X-Forwarded-For') ??
    '';
  const userAgent = request.headers.get('User-Agent') ?? '';

  context.waitUntil(
    env.DB.prepare(
      `INSERT INTO access_log (email, role, action, ip, user_agent, result)
       VALUES (?, ?, 'signin', ?, ?, 'ok')`,
    )
      .bind(email, userRole, ip, userAgent)
      .run()
      .catch((err) => console.error('[callback] access_log insert failed', err)),
  );

  // ------------------------------------------------------------------
  // 9 & 12 & 13. Set cookies + redirect
  // ------------------------------------------------------------------
  const destination = next && next.startsWith('/') ? next : '/';
  const headers = new Headers({
    Location: destination,
    'Cache-Control': 'no-store',
  });
  headers.append('Set-Cookie', sessionCookie);
  headers.append('Set-Cookie', refreshCookie);
  headers.append('Set-Cookie', clearStateCookie);

  return new Response(null, { status: 302, headers });
}
