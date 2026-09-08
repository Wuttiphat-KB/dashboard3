/**
 * Module-level cache for API responses.
 * Survives component unmounts — pages don't re-show "Loading..." on navigation.
 * Background refresh keeps data fresh.
 */

import { Station } from '@/lib/types';
import { FleetStation } from './useFleet';

interface CacheEntry<T> {
  data: T | null;
  timestamp: number;
  loading: boolean;
  error: string | null;
  promise: Promise<T> | null;
  subscribers: Set<() => void>;
}

const STALE_MS = 10_000;  // Background refresh after 10s

function makeCache<T>(): CacheEntry<T> {
  return { data: null, timestamp: 0, loading: false, error: null, promise: null, subscribers: new Set() };
}

const stationsCache = makeCache<Station[]>();
const fleetCache    = makeCache<FleetStation[]>();
const dashboardCache = new Map<string, CacheEntry<any>>();

function notify<T>(c: CacheEntry<T>) {
  // Defer to avoid setState-during-render: subscribers may be React force-update fns
  queueMicrotask(() => {
    for (const fn of c.subscribers) fn();
  });
}

async function fetchAndCache<T>(c: CacheEntry<T>, url: string): Promise<T> {
  // Skip during SSR — fetch with relative URL has no base on the server, and we
  // don't want to call our own API from inside Next.js at render time anyway.
  if (typeof window === 'undefined') return c.data as T;
  if (c.promise) return c.promise;
  c.loading = true;
  c.error = null;
  notify(c);

  c.promise = (async () => {
    try {
      // 60s client timeout — the deployment Mongo is slow on first-load; cached
      // requests come back in <1s but the initial cold fetch can take 30-60s.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60_000);
      let res: Response;
      try {
        res = await fetch(url, { signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
      if (!res.ok) {
        let detail = '';
        try {
          const body = await res.json();
          detail = body?.error ? ` — ${body.error}` : '';
        } catch {}
        throw new Error(`API ${res.status}${detail}`);
      }
      const data = await res.json();
      c.data = data;
      c.timestamp = Date.now();
      c.error = null;
      return data as T;
    } catch (err: any) {
      const msg = err?.name === 'AbortError' ? 'request timed out after 60s' : (err?.message || String(err));
      c.error = `${url}: ${msg}`;
      console.error('[dataCache]', c.error);
      throw err;
    } finally {
      c.loading = false;
      c.promise = null;
      notify(c);
    }
  })();
  return c.promise;
}

// ── Invalidation API (called by WebSocket listener for realtime updates) ──
// AppShell calls invalidateFleet() on EVERY WS message, and ~200 stations push
// heartbeat/meter/PM/PLC traffic continuously — so this throttle is really "how
// often does each open tab refetch the whole fleet, forever". At the old 1.5s,
// 17 connected tabs kept ~17 rebuilds of /api/fleet permanently in flight and
// buried Mongo. These intervals are matched to how fast the data behind each
// endpoint actually changes; /api/fleet is additionally cached server-side for
// 10s (lib/apiCache), so a refetch inside that window costs no Mongo work.
const FLEET_THROTTLE_MS     = 10_000;
const DASHBOARD_THROTTLE_MS = 4_000;
const STATIONS_THROTTLE_MS  = 60_000;   // station configs change only on save
const lastInvalidate: { fleet: number; stations: number; dashboard: Map<string, number> } = {
  fleet: 0,
  stations: 0,
  dashboard: new Map(),
};

export function invalidateFleet(): void {
  const now = Date.now();
  if (now - lastInvalidate.fleet < FLEET_THROTTLE_MS) return;
  lastInvalidate.fleet = now;
  fleetCache.timestamp = 0;
  fetchAndCache<FleetStation[]>(fleetCache, '/api/fleet').catch(() => {});
}

export function invalidateDashboard(stationId: string): void {
  const now = Date.now();
  const prev = lastInvalidate.dashboard.get(stationId) || 0;
  if (now - prev < DASHBOARD_THROTTLE_MS) return;
  lastInvalidate.dashboard.set(stationId, now);
  const c = dashboardCache.get(stationId);
  if (!c) return;
  c.timestamp = 0;
  fetchAndCache<any>(c, `/api/dashboard/${stationId}`).catch(() => {});
}

export function invalidateStations(): void {
  const now = Date.now();
  if (now - lastInvalidate.stations < STATIONS_THROTTLE_MS) return;
  lastInvalidate.stations = now;
  stationsCache.timestamp = 0;
  fetchAndCache<Station[]>(stationsCache, '/api/stations').catch(() => {});
}

/** Get cached data; trigger fetch if stale or missing */
export function getStations() {
  const c = stationsCache;
  const isStale = Date.now() - c.timestamp > STALE_MS;
  if (!c.data || isStale) {
    fetchAndCache<Station[]>(c, '/api/stations').then(data => {
      c.data = data.map((s: any) => ({ ...s, displayName: s.displayName || s.name || s.id }));
      notify(c);
    }).catch(() => {});
  }
  return c;
}

export function getFleet() {
  const c = fleetCache;
  const isStale = Date.now() - c.timestamp > STALE_MS;
  if (!c.data || isStale) {
    fetchAndCache<FleetStation[]>(c, '/api/fleet').catch(() => {});
  }
  return c;
}

export function getDashboard(stationId: string) {
  let c = dashboardCache.get(stationId);
  if (!c) {
    c = makeCache<any>();
    dashboardCache.set(stationId, c);
  }
  const isStale = Date.now() - c.timestamp > STALE_MS;
  if (!c.data || isStale) {
    fetchAndCache<any>(c, `/api/dashboard/${stationId}`).catch(() => {});
  }
  return c;
}

export function subscribe<T>(c: CacheEntry<T>, fn: () => void): () => void {
  c.subscribers.add(fn);
  return () => { c.subscribers.delete(fn); };
}
