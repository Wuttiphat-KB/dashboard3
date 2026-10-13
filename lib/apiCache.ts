/**
 * Server-side response cache with single-flight + stale-while-revalidate.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every open browser tab refetches /api/fleet on WebSocket traffic. With ~17
 * tabs connected, 17 *independent* executions of the route ran concurrently,
 * each firing ~50 Mongo queries. Mongo saturated, every request slowed down,
 * and the slower it got the more requests piled up — a death spiral that ended
 * with /api/fleet taking 20+ minutes and the UI showing "0 stations".
 *
 * `cachedResponse()` collapses all of that into ONE computation per TTL window:
 *   - fresh (age < ttlMs)          → return cached data, zero Mongo work
 *   - stale but usable             → return cached data AND refresh in background
 *   - stale beyond maxStaleMs      → await the refresh (first load / long outage)
 *   - a refresh already in flight  → every caller awaits that same promise
 *
 * Cached on globalThis so it survives HMR in dev and module re-evaluation.
 */

interface Entry<T> {
  data: T | null;
  at: number;                 // when `data` was produced
  promise: Promise<T> | null; // in-flight refresh, if any
}

const g = globalThis as any;
if (!g.__apiResponseCache) g.__apiResponseCache = new Map<string, Entry<any>>();
const store: Map<string, Entry<any>> = g.__apiResponseCache;

function entryFor<T>(key: string): Entry<T> {
  let e = store.get(key);
  if (!e) { e = { data: null, at: 0, promise: null }; store.set(key, e); }
  return e;
}

export interface CachedResult<T> {
  data: T;
  /** 'fresh' = served from cache, 'stale' = served from cache while refreshing, 'miss' = computed now */
  state: 'fresh' | 'stale' | 'miss';
  ageMs: number;
}

export async function cachedResponse<T>(
  key: string,
  ttlMs: number,
  maxStaleMs: number,
  compute: () => Promise<T>,
): Promise<CachedResult<T>> {
  const e = entryFor<T>(key);
  const now = Date.now();
  const age = now - e.at;

  // 1. Fresh enough — no Mongo work at all.
  if (e.data !== null && age < ttlMs) {
    return { data: e.data, state: 'fresh', ageMs: age };
  }

  // 2. Start (or join) a refresh.
  if (!e.promise) {
    e.promise = (async () => {
      try {
        const data = await compute();
        e.data = data;
        e.at = Date.now();
        return data;
      } finally {
        e.promise = null;
      }
    })();
    // A background refresh has no awaiting caller in the stale path below;
    // swallow its rejection here so it never becomes an unhandled rejection.
    e.promise.catch(() => {});
  }

  // 3. Stale but recent enough to serve immediately — the refresh runs behind it.
  //    This is what keeps the UI responsive when Mongo is having a bad day.
  if (e.data !== null && age < maxStaleMs) {
    return { data: e.data, state: 'stale', ageMs: age };
  }

  // 4. Nothing usable — wait for the shared refresh.
  const data = await e.promise;
  return { data, state: 'miss', ageMs: 0 };
}

/** Drop a cached entry so the next request recomputes (used after config saves). */
export function invalidateResponse(key: string): void {
  const e = store.get(key);
  if (!e) return;
  e.data = null;
  e.at = 0;
  // leave e.promise alone — an in-flight compute is still valid to await
}
