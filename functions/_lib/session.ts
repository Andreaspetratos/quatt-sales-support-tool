/**
 * Shared session helpers using Web Crypto API (crypto.subtle).
 * Cookie format: base64url(JSON payload).<base64url(HMAC-SHA256 signature)>
 */

// ---------------------------------------------------------------------------
// Encoding utilities
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
  // Restore standard base64 padding
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

// ---------------------------------------------------------------------------
// HMAC key import
// ---------------------------------------------------------------------------

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sign an arbitrary payload object.
 * Returns: base64url(JSON).<base64url(HMAC-SHA256 signature)>
 */
export async function signPayload(
  payload: Record<string, unknown>,
  secret: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = uint8ToBase64Url(encoder.encode(payloadJson));

  const key = await importHmacKey(secret);
  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(payloadB64),
  );
  const signatureB64 = uint8ToBase64Url(new Uint8Array(signatureBuffer));

  return `${payloadB64}.${signatureB64}`;
}

/**
 * Verify and decode a signed cookie value.
 * Returns the parsed payload object, or null if invalid / expired.
 */
export async function verifySession(
  cookie: string,
  secret: string,
): Promise<Record<string, unknown> | null> {
  const parts = cookie.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, signatureB64] = parts;

  // Verify HMAC signature
  const encoder = new TextEncoder();
  const key = await importHmacKey(secret);
  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      'HMAC',
      key,
      base64UrlToUint8(signatureB64).buffer as ArrayBuffer,
      encoder.encode(payloadB64).buffer as ArrayBuffer,
    );
  } catch {
    return null;
  }

  if (!valid) return null;

  // Decode payload
  let payload: Record<string, unknown>;
  try {
    const payloadBytes = base64UrlToUint8(payloadB64);
    const payloadJson = new TextDecoder().decode(payloadBytes);
    payload = JSON.parse(payloadJson) as Record<string, unknown>;
  } catch {
    return null;
  }

  // Check expiry
  const exp = payload['exp'];
  if (typeof exp !== 'number' || exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return payload;
}

/**
 * Parse a Cookie header string into a key→value map.
 */
export function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(';').map((pair) => {
      const idx = pair.indexOf('=');
      if (idx === -1) return [pair.trim(), ''];
      return [pair.slice(0, idx).trim(), pair.slice(idx + 1).trim()];
    }),
  );
}
