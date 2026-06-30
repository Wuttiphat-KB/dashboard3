/**
 * Module-level cache for the station list served by /api/stations.
 *
 * Stashed on `globalThis` so it survives Next.js HMR in dev AND so other API
 * routes (/api/stations/save + /api/stations/delete) can invalidate it after an
 * add / edit / delete — otherwise a freshly-saved change is masked by the stale
 * cached list until the TTL expires.
 */

interface StationsCache {
  data: any[] | null;
  at: number;
  promise: Promise<any[]> | null;
}

const g = globalThis as any;
if (!g.__stationsListCache) {
  g.__stationsListCache = { data: null, at: 0, promise: null } as StationsCache;
}

export function getStationsCache(): StationsCache {
  return g.__stationsListCache as StationsCache;
}

export function invalidateStationsCache(): void {
  const c = getStationsCache();
  c.data = null;
  c.at = 0;
  c.promise = null;
}
