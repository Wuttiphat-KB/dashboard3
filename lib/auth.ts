/**
 * Lightweight session auth — HMAC-signed cookie, no server state.
 *
 * Cookie value: v2.<base64url JSON {u: username, r: role, c: customer, e: expiresAtMs}>.<hmacSha256>
 * Users live in MongoDB (lib/users.ts); AUTH_USERNAME/AUTH_PASSWORD is a built-in admin.
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

/**
 * admin    — everything: all stations, config, settings, users, audit log, vSECC logs.
 * customer — read-only, limited to stations whose customer.name equals the user's customer;
 *            can view dashboards/alerts/statistics and export energy reports.
 */
export type AccountRole = 'admin' | 'customer';
export const ACCOUNT_ROLES: AccountRole[] = ['admin', 'customer'];

export interface SessionIdentity {
  username: string;
  role: AccountRole;
  customer?: string;      // required for role 'customer'
}

/** The .env.local AUTH_USERNAME account is a built-in admin that always works (bootstrap / recovery). */
export function isEnvAdmin(username: string): boolean {
  return username === getExpectedCredentials().username;
}

export const TOKEN_TTL_MS   = 7 * 86_400_000;  // 7 days (legacy fallback — sessions now expire daily, see nextDailyExpiry)

// Sessions expire every day at 07:00 Thailand time (ICT = UTC+7, no DST), so
// everyone must log in again after 7am each day.
const ICT_OFFSET_MS   = 7 * 3_600_000;
const EXPIRE_HOUR_ICT = 7;

/**
 * Absolute timestamp (ms) of the next 07:00 Thailand-time boundary strictly
 * after `now`. Login at 06:00 ICT → expires 07:00 ICT the same day (1h);
 * login at 08:00 ICT → expires 07:00 ICT the next day.
 */
export function nextDailyExpiry(now = Date.now()): number {
  // Shift to ICT wall-clock to read the local calendar day/time.
  const ict = new Date(now + ICT_OFFSET_MS);
  const y = ict.getUTCFullYear();
  const m = ict.getUTCMonth();
  const d = ict.getUTCDate();
  // 07:00 ICT expressed as a UTC timestamp = that wall time minus the offset.
  let expiry = Date.UTC(y, m, d, EXPIRE_HOUR_ICT, 0, 0, 0) - ICT_OFFSET_MS;
  if (expiry <= now) {
    expiry = Date.UTC(y, m, d + 1, EXPIRE_HOUR_ICT, 0, 0, 0) - ICT_OFFSET_MS;
  }
  return expiry;
}

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

/** Constant-time check of the built-in .env admin credentials. */
export function checkEnvAdmin(user: string, pass: string): boolean {
  const exp = getExpectedCredentials();
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
//
// Cookie value: "v2.<base64url(JSON{u,r,c,e})>.<hmacHex>"
// Role + customer travel inside the signed token so the Edge proxy can gate
// pages without a DB call; API routes additionally re-check the user record
// (lib/authorization.getRequestSession) so disabling a user takes effect at once.

function utf8ToBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return toBase64Url(bin);
}

function base64UrlToUtf8(s: string): string {
  const bin = fromBase64UrlToString(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export async function signToken(identity: SessionIdentity, expiresAt = nextDailyExpiry()): Promise<string> {
  const payload = utf8ToBase64Url(JSON.stringify({
    u: identity.username, r: identity.role, c: identity.customer || undefined, e: expiresAt,
  }));
  const sig = await hmacHex(`v2.${payload}`, getSecret());
  return `v2.${payload}.${sig}`;
}

export interface VerifiedSession {
  username:  string;
  expiresAt: number;
  role: AccountRole;
  customer?: string;
}

export async function verifyToken(token: string | undefined | null): Promise<VerifiedSession | null> {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'v2') return null;
    const [, payload, sig] = parts;
    const expected = await hmacHex(`v2.${payload}`, getSecret());
    // Constant-time compare
    if (sig.length !== expected.length) return null;
    let diff = 0;
    for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
    if (diff !== 0) return null;

    const d = JSON.parse(base64UrlToUtf8(payload));
    const username = typeof d?.u === 'string' ? d.u : '';
    const role = d?.r as AccountRole;
    const expiresAt = Number(d?.e);
    const customer = typeof d?.c === 'string' && d.c.trim() ? d.c.trim() : undefined;
    if (!username || !ACCOUNT_ROLES.includes(role)) return null;
    if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) return null;
    if (role === 'customer' && !customer) return null;
    return { username, expiresAt, role, ...(customer ? { customer } : {}) };
  } catch {
    return null;
  }
}
