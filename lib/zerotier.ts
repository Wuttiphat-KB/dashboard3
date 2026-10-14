/**
 * ZeroTier automation for reaching a station's LAN (server-side only).
 *
 * Each station's ZeroTier field holds its *network ID*. Every station uses the
 * same LAN (192.168.3.0/24, routed by the cabinet router), so the server must
 * be a member of ONE station network at a time or the routes collide.
 * `withStationNetwork()` therefore serialises callers, leaves any other
 * station network, joins + self-authorises the target one, waits for the
 * managed route and then runs the callback.
 *
 * Needs, in .env.local:
 *   ZEROTIER_API_TOKEN     ZeroTier Central API token (account owning the station networks)
 *   ZEROTIER_LOCAL_TOKEN   contents of C:\ProgramData\ZeroTier\One\authtoken.secret
 *                          (or ZEROTIER_AUTHTOKEN_PATH pointing to a readable copy)
 *   ZEROTIER_LOCAL_URL     optional, default http://127.0.0.1:9993
 *   ZEROTIER_MEMBER_NAME   optional, name shown in Central, default "dashboard-server"
 */

import { readFileSync } from 'fs';

const CENTRAL = process.env.ZEROTIER_CENTRAL_URL || 'https://api.zerotier.com/api/v1';
const DEFAULT_AUTHTOKEN_PATH = 'C:\\ProgramData\\ZeroTier\\One\\authtoken.secret';
const JOIN_WAIT_MS = 45_000;

export { findRouteConflicts as _findRouteConflictsForTest };

export class ZeroTierError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

export function isNetworkId(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{16}$/i.test(v.trim());
}

export function zerotierConfigured(): boolean {
  return !!process.env.ZEROTIER_API_TOKEN;
}

function localToken(): string {
  if (process.env.ZEROTIER_LOCAL_TOKEN) return process.env.ZEROTIER_LOCAL_TOKEN.trim();
  const p = process.env.ZEROTIER_AUTHTOKEN_PATH || DEFAULT_AUTHTOKEN_PATH;
  try {
    return readFileSync(p, 'utf8').trim();
  } catch {
    throw new ZeroTierError(
      `Cannot read the local ZeroTier auth token (${p}). Set ZEROTIER_LOCAL_TOKEN in .env.local to the contents of authtoken.secret.`, 500);
  }
}

async function local(path: string, init: RequestInit = {}): Promise<any> {
  const base = process.env.ZEROTIER_LOCAL_URL || 'http://127.0.0.1:9993';
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: { 'X-ZT1-Auth': localToken(), 'Content-Type': 'application/json', ...(init.headers || {}) },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err: any) {
    if (err instanceof ZeroTierError) throw err;
    throw new ZeroTierError(`ZeroTier service is not reachable at ${base} — is ZeroTier One installed and running on this server?`, 502);
  }
  if (res.status === 401) throw new ZeroTierError('Local ZeroTier service rejected the auth token (check ZEROTIER_LOCAL_TOKEN)', 500);
  if (!res.ok) throw new ZeroTierError(`ZeroTier service ${path} returned HTTP ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function central(path: string, init: RequestInit = {}): Promise<any> {
  const token = process.env.ZEROTIER_API_TOKEN;
  if (!token) throw new ZeroTierError('ZEROTIER_API_TOKEN is not set in .env.local', 500);
  let res: Response;
  try {
    res = await fetch(`${CENTRAL}${path}`, {
      ...init,
      headers: { Authorization: `token ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err: any) {
    throw new ZeroTierError(`ZeroTier Central is not reachable: ${err?.message || err}`);
  }
  if (res.status === 401 || res.status === 403) throw new ZeroTierError(`ZeroTier Central denied access to ${path} — the API token's account must own/admin this network`, 502);
  if (!res.ok) throw new ZeroTierError(`ZeroTier Central ${path} returned HTTP ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ── Serialisation: one station network at a time ─────────────────────────
const g = globalThis as any;
g.__ztQueue ??= Promise.resolve();

function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = g.__ztQueue.then(fn, fn);
  g.__ztQueue = run.catch(() => {});
  return run;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── Route-overlap detection ──────────────────────────────────────────────
function parseCidr(cidr: string): { net: number; bits: number } | null {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/.exec(String(cidr || '').trim());
  if (!m) return null;                       // IPv6 / malformed → ignore
  const bits = Number(m[5]);
  if (bits > 32) return null;
  const ip = ((+m[1] << 24) | (+m[2] << 16) | (+m[3] << 8) | +m[4]) >>> 0;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { net: (ip & mask) >>> 0, bits };
}

function overlaps(a: string, b: string): boolean {
  const x = parseCidr(a), y = parseCidr(b);
  if (!x || !y) return false;
  const bits = Math.min(x.bits, y.bits);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((x.net & mask) >>> 0) === ((y.net & mask) >>> 0);
}

function routeTargets(n: any): string[] {
  return (n?.routes || []).map((r: any) => String(r?.target || '')).filter(Boolean);
}

/**
 * Other networks this server is still in whose routes overlap the target's
 * (e.g. a network joined by hand that also routes 192.168.3.0/24). Requests
 * could then reach the wrong cabinet, so the caller refuses to continue.
 */
function findRouteConflicts(target: any, others: any[]): string[] {
  const mine = routeTargets(target);
  const out: string[] = [];
  for (const o of others) {
    for (const r of routeTargets(o)) {
      const hit = mine.find(m => overlaps(m, r));
      if (hit) { out.push(`${o.id || o.nwid}${o.name ? ` (${o.name})` : ''} routes ${r}, overlapping ${hit}`); break; }
    }
  }
  return out;
}

async function ensureOnly(nwid: string, stationNetworkIds: Set<string>): Promise<void> {
  const target = nwid.toLowerCase();
  const status = await local('/status');
  const nodeId: string = status?.address;
  if (!nodeId) throw new ZeroTierError('Could not read this server\'s ZeroTier node ID');

  // Leave other *station* networks only — never touch unrelated networks.
  const joined: any[] = (await local('/network')) || [];
  for (const n of joined) {
    const id = String(n.id || n.nwid || '').toLowerCase();
    if (id && id !== target && stationNetworkIds.has(id)) {
      await local(`/network/${id}`, { method: 'DELETE' }).catch(() => {});
    }
  }

  const already = joined.find(n => String(n.id || n.nwid || '').toLowerCase() === target);
  if (!already || already.status !== 'OK') {
    await local(`/network/${target}`, { method: 'POST', body: JSON.stringify({ allowManaged: true }) });
    // Authorise ourselves via Central (idempotent) and label the member.
    await central(`/network/${target}/member/${nodeId}`, {
      method: 'POST',
      body: JSON.stringify({
        name: process.env.ZEROTIER_MEMBER_NAME || 'dashboard-server',
        config: { authorized: true },
      }),
    });
  }

  // Wait until the network is up with an address and its managed routes.
  const deadline = Date.now() + JOIN_WAIT_MS;
  let last = '';
  while (Date.now() < deadline) {
    const n = await local(`/network/${target}`).catch(() => null);
    last = n?.status || 'unknown';
    if (n?.status === 'OK' && (n.assignedAddresses || []).length > 0) {
      // Give the OS a moment to install the managed routes after first join.
      if (!already || already.status !== 'OK') await sleep(2000);
      const others = ((await local('/network')) || [])
        .filter((o: any) => String(o.id || o.nwid || '').toLowerCase() !== target);
      const conflicts = findRouteConflicts(n, others);
      if (conflicts.length) {
        console.warn(`[zerotier] route conflict for ${target}: ${conflicts.join('; ')}`);
        throw new ZeroTierError(
          `Route conflict — another ZeroTier network on this server overlaps station network ${target}: ` +
          `${conflicts.join('; ')}. Leave that network on the server (zerotier-cli leave <id>) and retry.`, 409);
      }
      return;
    }
    if (n?.status === 'ACCESS_DENIED' || n?.status === 'NOT_FOUND') {
      throw new ZeroTierError(`ZeroTier network ${target}: ${n.status}`);
    }
    await sleep(1000);
  }
  throw new ZeroTierError(`Timed out joining ZeroTier network ${target} (last status: ${last})`, 504);
}

/**
 * Run `fn` while this server is a member of station network `nwid` only.
 * Calls are queued so two stations are never reached at the same time.
 */
export function withStationNetwork<T>(nwid: string, stationNetworkIds: Iterable<string>, fn: () => Promise<T>): Promise<T> {
  const ids = new Set([...stationNetworkIds].map(s => s.toLowerCase()));
  return exclusive(async () => {
    await ensureOnly(nwid, ids);
    return fn();
  });
}
