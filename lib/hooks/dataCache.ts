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
  promise: Promise<T> | null;
  subscribers: Set<() => void>;
}

const STALE_MS = 10_000;  // Background refresh after 10s

function makeCache<T>(): CacheEntry<T> {
  return { data: null, timestamp: 0, loading: false, promise: null, subscribers: new Set() };
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
  if (c.promise) return c.promise;
  c.loading = true;
  notify(c);

  c.promise = (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = await res.json();
      c.data = data;
      c.timestamp = Date.now();
      return data as T;
    } finally {
      c.loading = false;
      c.promise = null;
      notify(c);
    }
  })();
  return c.promise;
}

// ── Invalidation API (called by WebSocket listener for realtime updates) ──
// Throttled to avoid stampeding the API on burst MQTT traffic
const INVALIDATE_THROTTLE_MS = 1500;
const lastInvalidate: { fleet: number; stations: number; dashboard: Map<string, number> } = {
  fleet: 0,
  stations: 0,
  dashboard: new Map(),
};

export function invalidateFleet(): void {
  const now = Date.now();
  if (now - lastInvalidate.fleet < INVALIDATE_THROTTLE_MS) return;
  lastInvalidate.fleet = now;
  fleetCache.timestamp = 0;
  fetchAndCache<FleetStation[]>(fleetCache, '/api/fleet').catch(() => {});
}

export function invalidateDashboard(stationId: string): void {
  const now = Date.now();
  const prev = lastInvalidate.dashboard.get(stationId) || 0;
  if (now - prev < INVALIDATE_THROTTLE_MS) return;
  lastInvalidate.dashboard.set(stationId, now);
  const c = dashboardCache.get(stationId);
  if (!c) return;
  c.timestamp = 0;
  fetchAndCache<any>(c, `/api/dashboard/${stationId}`).catch(() => {});
}

export function invalidateStations(): void {
  const now = Date.now();
  if (now - lastInvalidate.stations < INVALIDATE_THROTTLE_MS) return;
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
