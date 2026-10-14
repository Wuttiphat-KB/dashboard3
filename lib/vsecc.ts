/**
 * vSECC (Vector) REST API client — server-side only.
 *
 * Uses the same API as the vSECC WebUI "Log Manager" page (vSECC RESTful API v6.2):
 *   POST /login                  { name, password } → JWT
 *   GET  /logging/filenames      → ["charging-manager-1.log", "vsecc.log", ...]
 *   GET  /logging/files          → zip of all logs
 *   GET  /logging/files/{name}   → one log file
 *
 * Configure in .env.local:
 *   VSECC_USERNAME      WebUI user dedicated to log access
 *   VSECC_PASSWORD
 *   VSECC_LAN_URL       vSECC address inside the cabinet LAN (default http://192.168.3.11/api),
 *                       used when the station's ZeroTier field is a network ID
 *   VSECC_URL_TEMPLATE  used when the ZeroTier field is an IP; {zerotierIp} is replaced
 *                       (default: http://{zerotierIp}/api)
 *
 * Only read endpoints are exposed — never wire up DELETE from the dashboard.
 */

const DEFAULT_TEMPLATE = 'http://{zerotierIp}/api';
const DEFAULT_LAN_URL  = 'http://192.168.3.11/api';
const LOGIN_TIMEOUT_MS = 10_000;
const TOKEN_TTL_MS     = 10 * 60_000;   // re-login every 10 min even if not rejected

export class VseccError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

export function vseccConfigured(): boolean {
  return !!process.env.VSECC_USERNAME && !!process.env.VSECC_PASSWORD;
}

/**
 * Where to reach a station's vSECC API:
 *   1. station.vseccApiUrl if set
 *   2. ZeroTier field holds a network ID → VSECC_LAN_URL (default http://192.168.3.11/api),
 *      reached through the station's ZeroTier managed route (see lib/zerotier.ts)
 *   3. ZeroTier field holds an IP → VSECC_URL_TEMPLATE with {zerotierIp}
 */
export function vseccBaseUrl(station: { zerotierIp?: string; vseccApiUrl?: string }): string {
  if (station.vseccApiUrl) return station.vseccApiUrl.trim().replace(/\/+$/, '');
  const host = (station.zerotierIp || '').trim();
  if (!host) throw new VseccError('This station has no ZeroTier network ID / IP and no "vSECC API URL" set in Config', 400);
  if (/^[0-9a-f]{16}$/i.test(host)) {
    return (process.env.VSECC_LAN_URL || DEFAULT_LAN_URL).replace(/\/+$/, '');
  }
  const tpl = process.env.VSECC_URL_TEMPLATE || DEFAULT_TEMPLATE;
  return tpl.replace('{zerotierIp}', host).replace(/\/+$/, '');
}

const g = globalThis as any;
const tokens: Map<string, { token: string; at: number }> = g.__vseccTokens ??= new Map();

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, cache: 'no-store' });
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new VseccError(`vSECC did not respond within ${Math.round(timeoutMs / 1000)}s (${url})`, 504);
    throw new VseccError(`Cannot reach vSECC at ${url}: ${err?.cause?.code || err?.message || err}`, 502);
  } finally {
    clearTimeout(t);
  }
}

/** The login endpoint has been seen returning the JWT as raw text, quoted text or JSON. */
function extractToken(body: string): string {
  const s = body.trim();
  try {
    const j = JSON.parse(s);
    if (typeof j === 'string') return j;
    const tok = j?.token || j?.access_token || j?.accessToken || j?.jwt;
    if (typeof tok === 'string') return tok;
  } catch { /* raw text */ }
  return s.replace(/^"|"$/g, '');
}

async function login(base: string, key: string): Promise<string> {
  if (!vseccConfigured()) throw new VseccError('VSECC_USERNAME / VSECC_PASSWORD are not set in .env.local', 500);
  const res = await fetchWithTimeout(`${base}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: process.env.VSECC_USERNAME, password: process.env.VSECC_PASSWORD }),
  }, LOGIN_TIMEOUT_MS);
  if (!res.ok) throw new VseccError(`vSECC login failed (HTTP ${res.status})`, res.status === 401 ? 502 : 502);
  const token = extractToken(await res.text());
  if (!token) throw new VseccError('vSECC login returned an empty token');
  tokens.set(key, { token, at: Date.now() });
  return token;
}

/** Authenticated GET; re-logs in once on 401. */
export async function vseccGet(
  base: string, path: string, timeoutMs = 30_000, cacheKey = base, extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const key = `${cacheKey}|${base}`;
  let cached = tokens.get(key);
  if (!cached || Date.now() - cached.at > TOKEN_TTL_MS) cached = { token: await login(base, key), at: Date.now() };
  let res = await fetchWithTimeout(`${base}${path}`, { headers: { ...extraHeaders, Authorization: `Bearer ${cached.token}` } }, timeoutMs);
  if (res.status === 401) {
    const token = await login(base, key);
    res = await fetchWithTimeout(`${base}${path}`, { headers: { ...extraHeaders, Authorization: `Bearer ${token}` } }, timeoutMs);
  }
  if (!res.ok) throw new VseccError(`vSECC ${path} returned HTTP ${res.status}`, res.status === 404 ? 404 : 502);
  return res;
}

export function isSafeLogName(name: string): boolean {
  return /^[\w.\-]{1,200}$/.test(name) && !name.includes('..');
}
