/**
 * Lightweight session auth — HMAC-signed cookie, no server state.
 *
 * Cookie value layout (base64url-encoded):
 *   <username>:<expiresAtMs>:<hmacSha256>
 *
 * Validation happens entirely from env vars + the cookie itself, so it works
 * across server restarts and inside Edge-runtime middleware (uses Web Crypto).
 *
 * Configure with .env.local:
 *   AUTH_USERNAME = admin
 *   AUTH_PASSWORD = secret
 *   AUTH_SECRET   = <random-32+-char-string>   (signs the session cookie)
 */

export const SESSION_COOKIE = 'auth_session';
export const TOKEN_TTL_MS   = 7 * 86_400_000;  // 7 days

const DEFAULT_SECRET = 'flexxfast-dev-secret-CHANGE-ME-in-prod-2026';

function getSecret(): string {
  return process.env.AUTH_SECRET || DEFAULT_SECRET;
}

export function getExpectedCredentials(): { username: string; password: string } {
  return {
    username: process.env.AUTH_USERNAME || 'admin',
    password: process.env.AUTH_PASSWORD || 'admin',
  };
}

export function validateCredentials(user: string, pass: string): boolean {
  const exp = getExpectedCredentials();
  // Constant-time-ish: compare length first, then chars.
  if (user.length !== exp.username.length || pass.length !== exp.password.length) return false;
  let diff = 0;
  for (let i = 0; i < user.length; i++) diff |= user.charCodeAt(i) ^ exp.username.charCodeAt(i);
  for (let i = 0; i < pass.length; i++) diff |= pass.charCodeAt(i) ^ exp.password.charCodeAt(i);
  return diff === 0;
}

// ── Base64URL helpers (Edge-runtime-safe — no Buffer) ─────────────────

function toBase64Url(bytes: ArrayBuffer | Uint8Array | string): string {
  let bin: string;
  if (typeof bytes === 'string') {
    bin = bytes;
  } else {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let s = '';
    for (let i = 0; i < u8.byteLength; i++) s += String.fromCharCode(u8[i]);
    bin = s;
  }
  const b64 = (globalThis as any).btoa(bin);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64UrlToString(s: string): string {
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return (globalThis as any).atob(b64);
}

function hexFromArrayBuffer(buf: ArrayBuffer): string {
  const u8 = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u8.length; i++) s += u8[i].toString(16).padStart(2, '0');
  return s;
}

// ── HMAC-SHA256 (Web Crypto — works in Edge + Node) ───────────────────

async function hmacHex(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return hexFromArrayBuffer(sig);
}

// ── Token sign / verify ───────────────────────────────────────────────

export async function signToken(username: string, ttlMs = TOKEN_TTL_MS): Promise<string> {
  const expiresAt = Date.now() + ttlMs;
  const payload   = `${username}:${expiresAt}`;
  const sig       = await hmacHex(payload, getSecret());
  return toBase64Url(`${payload}:${sig}`);
}

export interface VerifiedSession {
  username:  string;
  expiresAt: number;
}

export async function verifyToken(token: string | undefined | null): Promise<VerifiedSession | null> {
  if (!token) return null;
  try {
    const decoded = fromBase64UrlToString(token);
    // payload may contain ':' in username theoretically — split from the right.
    const lastColon = decoded.lastIndexOf(':');
    const expColon  = decoded.lastIndexOf(':', lastColon - 1);
    if (lastColon === -1 || expColon === -1) return null;
    const username     = decoded.slice(0, expColon);
    const expiresAtStr = decoded.slice(expColon + 1, lastColon);
    const sig          = decoded.slice(lastColon + 1);
    const expiresAt    = Number(expiresAtStr);
    if (!username || isNaN(expiresAt)) return null;
    if (Date.now() > expiresAt) return null;
    const expected = await hmacHex(`${username}:${expiresAt}`, getSecret());
    // Constant-time compare
    if (sig.length !== expected.length) return null;
    let diff = 0;
    for (let i = 0; i < sig.length; i++) {
      diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    if (diff !== 0) return null;
    return { username, expiresAt };
  } catch {
    return null;
  }
}
