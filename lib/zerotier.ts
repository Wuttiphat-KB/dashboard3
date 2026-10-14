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
 *   ZEROTIER_LEAVE_CONFLICTING   optional, default on — leave any other joined network that also routes
 *                          the cabinet LAN (e.g. joined by hand). 0 = refuse with "Route conflict" instead.
 *   ZEROTIER_IDLE_LEAVE_MINUTES  optional, default 10 — leave the station network after
 *                          this long without a Manager Log request (0 = stay joined)
 */

import { readFileSync, promises as fsp } from 'fs';
import os from 'os';
import path from 'path';

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
    return readFileSync(/*turbopackIgnore: true*/ p, 'utf8').trim();
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

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// The in-process queue above only protects one Node process. If two dashboard
// processes run on the same server (e.g. an old one left running), they would
// switch ZeroTier networks under each other. A lock file in the temp folder
// serialises them too. A holder that dies leaves a stale file, taken over after LOCK_STALE_MS.
const LOCK_FILE = path.join(os.tmpdir(), 'ev-dashboard-zerotier.lock');
const LOCK_STALE_MS = 3 * 60_000;

async function withFileLock<T>(fn: () => Promise<T>): Promise<T> {
  let warned = false;
  for (;;) {
    try {
      const fh = await fsp.open(LOCK_FILE, 'wx');
      await fh.writeFile(`${process.pid}`);
      await fh.close();
      break;
    } catch (err: any) {
      if (err?.code !== 'EEXIST') { console.warn('[zerotier] cannot create lock file, continuing without it:', err?.message); return fn(); }
      const st = await fsp.stat(LOCK_FILE).catch(() => null);
      if (!st || Date.now() - st.mtimeMs > LOCK_STALE_MS) { await fsp.unlink(LOCK_FILE).catch(() => {}); continue; }
      if (!warned) {
        warned = true;
        const owner = (await fsp.readFile(LOCK_FILE, 'utf8').catch(() => '')).trim();
        if (owner && owner !== String(process.pid)) console.log(`[zerotier] waiting for process ${owner} (another dashboard process is using ZeroTier)`);
      }
      await sleep(500);
    }
  }
  // Keep the lock fresh during long transfers.
  const keep = setInterval(() => { const t = new Date(); fsp.utimes(LOCK_FILE, t, t).catch(() => {}); }, 30_000);
  try { return await fn(); }
  finally { clearInterval(keep); await fsp.unlink(LOCK_FILE).catch(() => {}); }
}

function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const locked = () => withFileLock(fn);
  const run = g.__ztQueue.then(locked, locked);
  g.__ztQueue = run.catch(() => {});
  return run;
}

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

/** ZEROTIER_LEAVE_CONFLICTING=0 keeps hand-joined overlapping networks (the request then fails instead). */
function autoLeaveConflicts(): boolean {
  return process.env.ZEROTIER_LEAVE_CONFLICTING !== '0';
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
      let conflicts = findRouteConflicts(n, others);
      if (conflicts.length && autoLeaveConflicts()) {
        // Networks joined by hand on the server (not linked to any station) that also route the
        // cabinet LAN: leave them, otherwise requests could reach the wrong cabinet.
        const ids = others.filter((o: any) => findRouteConflicts(n, [o]).length).map((o: any) => String(o.id || o.nwid).toLowerCase());
        console.warn(`[zerotier] leaving networks that overlap station network ${target}: ${conflicts.join('; ')}`);
        for (const id of ids) await local(`/network/${id}`, { method: 'DELETE' }).catch(() => {});
        await sleep(2000);
        const after = ((await local('/network')) || []).filter((o: any) => String(o.id || o.nwid || '').toLowerCase() !== target);
        conflicts = findRouteConflicts(n, after);
      }
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

// ── Idle auto-leave ──────────────────────────────────────────────────────
// After the last request for a station network, a timer leaves it once the
// server has been idle for ZEROTIER_IDLE_LEAVE_MINUTES. Every new request
// resets the timer. The leave goes through the same queue, so it can never
// cut off a transfer that is in progress.
g.__ztIdle ??= { timer: null as NodeJS.Timeout | null, nwid: '' as string };

function idleLeaveMs(): number {
  const raw = process.env.ZEROTIER_IDLE_LEAVE_MINUTES;
  const min = raw === undefined || raw === '' ? 10 : Number(raw);
  return Number.isFinite(min) && min > 0 ? min * 60_000 : 0;
}

function scheduleIdleLeave(nwid: string): void {
  const ms = idleLeaveMs();
  if (g.__ztIdle.timer) clearTimeout(g.__ztIdle.timer);
  g.__ztIdle.timer = null;
  if (!ms) return;
  g.__ztIdle.nwid = nwid;
  g.__ztIdle.timer = setTimeout(() => {
    g.__ztIdle.timer = null;
    void exclusive(async () => {
      // A newer request may have switched networks or re-armed the timer.
      if (g.__ztIdle.timer || g.__ztIdle.nwid !== nwid) return;
      try {
        await local(`/network/${nwid}`, { method: 'DELETE' });
        console.log(`[zerotier] left ${nwid} after ${Math.round(ms / 60_000)} min idle`);
      } catch (err: any) {
        console.warn(`[zerotier] idle leave of ${nwid} failed:`, err?.message || err);
      }
    });
  }, ms);
  g.__ztIdle.timer.unref?.();
}

/** Network the server is currently parked on for Manager Log, and when it will auto-leave. */
export function zerotierIdleState(): { nwid: string | null; leavesInMs: number } {
  return { nwid: g.__ztIdle.timer ? g.__ztIdle.nwid : null, leavesInMs: g.__ztIdle.timer ? idleLeaveMs() : 0 };
}

/**
 * Run `fn` while this server is a member of station network `nwid` only.
 * Calls are queued so two stations are never reached at the same time.
 */
export function withStationNetwork<T>(nwid: string, stationNetworkIds: Iterable<string>, fn: () => Promise<T>): Promise<T> {
  const ids = new Set([...stationNetworkIds].map(s => s.toLowerCase()));
  const target = nwid.toLowerCase();
  return exclusive(async () => {
    if (g.__ztIdle.timer) { clearTimeout(g.__ztIdle.timer); g.__ztIdle.timer = null; }
    try {
      await ensureOnly(target, ids);
      return await fn();
    } finally {
      scheduleIdleLeave(target);   // re-arm after every request, success or not
    }
  });
}

// ── Is the cabinet online? (Central, no join needed) ─────────────────────
const ONLINE_WINDOW_MS = 10 * 60_000;
const onlineCache: Map<string, { at: number; v: { online: boolean | null; lastSeen: number | null } }> = g.__ztOnlineCache ??= new Map();

/**
 * Asks ZeroTier Central whether any member of the station network other than
 * this server has been seen recently. Lets the log collector skip an offline
 * cabinet in ~1 s instead of joining the network and waiting for timeouts.
 * online=null means "don't know" (no data / Central not configured) → caller should just try.
 */
export async function cabinetOnline(nwid: string): Promise<{ online: boolean | null; lastSeen: number | null }> {
  const id = nwid.trim().toLowerCase();
  const hit = onlineCache.get(id);
  if (hit && Date.now() - hit.at < 60_000) return hit.v;
  let v: { online: boolean | null; lastSeen: number | null } = { online: null, lastSeen: null };
  if (zerotierConfigured()) {
    try {
      g.__ztSelfId ??= (await local('/status').catch(() => null))?.address || null;
      const members: any[] = (await central(`/network/${id}/member`)) || [];
      const others = members.filter(m => m?.nodeId && m.nodeId !== g.__ztSelfId && m.config?.authorized !== false);
      const lastSeen = Math.max(0, ...others.map(m => Number(m.lastSeen || m.lastOnline || 0)));
      if (lastSeen > 0) v = { online: Date.now() - lastSeen < ONLINE_WINDOW_MS, lastSeen };
    } catch { /* unknown → caller tries normally */ }
  }
  onlineCache.set(id, { at: Date.now(), v });
  return v;
}
