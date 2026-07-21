/**
 * GET /auth/login
 *
 * Initiates the Google OAuth 2.0 + PKCE flow.
 *
 * Steps:
 *  1. Generate a cryptographically random state (32 bytes, hex).
 *  2. Generate PKCE code_verifier (64 bytes, base64url) and
 *     code_challenge (SHA-256 of verifier, base64url).
 *  3. Stash { state, codeVerifier, next } in __oauth_state cookie.
 *  4. Redirect to Google's authorization endpoint.
 */

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

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

function uint8ToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

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

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);

  // Respect ?next= redirect target (default to /)
  const next = url.searchParams.get('next') ?? '/';

  // ------------------------------------------------------------------
  // 1. Random state (32 bytes → hex)
  // ------------------------------------------------------------------
  const stateBytes = new Uint8Array(32);
  crypto.getRandomValues(stateBytes);
  const state = uint8ToHex(stateBytes);

  // ------------------------------------------------------------------
  // 2. PKCE code_verifier + code_challenge
  // ------------------------------------------------------------------
  const verifierBytes = new Uint8Array(64);
  crypto.getRandomValues(verifierBytes);
  const codeVerifier = uint8ToBase64Url(verifierBytes);

  const challengeBuffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(codeVerifier),
  );
  const codeChallenge = uint8ToBase64Url(new Uint8Array(challengeBuffer));

  // ------------------------------------------------------------------
  // 3. Stash in __oauth_state cookie (10 min, HttpOnly, Secure, Lax)
  // ------------------------------------------------------------------
  const stateCookiePayload = JSON.stringify({ state, codeVerifier, next });
  const stateCookieValue = btoa(stateCookiePayload); // plain base64, not signed

  const stateCookie = [
    `__oauth_state=${stateCookieValue}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Path=/',
    'Max-Age=600', // 10 minutes
  ].join('; ');

  // ------------------------------------------------------------------
  // 4. Build Google authorization URL
  // ------------------------------------------------------------------
  const origin = url.origin;
  const redirectUri = `${origin}/auth/callback`;

  const authParams = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'select_account',
    // NOTE: hd= is intentionally omitted — domain restriction is enforced
    // server-side in /auth/callback using the id_token's hd claim.
  });

  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${authParams.toString()}`;

  return new Response(null, {
    status: 302,
    headers: {
      Location: googleAuthUrl,
      'Set-Cookie': stateCookie,
      'Cache-Control': 'no-store',
    },
  });
}
