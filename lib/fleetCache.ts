/**
 * Module-level cache for the station list used by /api/fleet.
 *
 * Stashed on `globalThis` so it survives Next.js HMR in dev AND so other API
 * routes (notably /api/stations/save) can invalidate it after add/edit.
 */

interface FleetCache {
  data: any[] | null;
  at: number;
  promise: Promise<any[]> | null;
}

const g = globalThis as any;
if (!g.__fleetStationsCache) {
  g.__fleetStationsCache = { data: null, at: 0, promise: null } as FleetCache;
}

export function getFleetCache(): FleetCache {
  return g.__fleetStationsCache as FleetCache;
}

export function invalidateFleetCache(): void {
  const c = getFleetCache();
  c.data = null;
  c.at = 0;
  c.promise = null;
}
