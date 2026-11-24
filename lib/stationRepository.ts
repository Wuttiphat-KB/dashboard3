import { MongoClient } from 'mongodb';
import { getStationsCache } from './stationsCache';
import { scanStationCollections } from './stationScan';

const STATION_DB = 'Station';

// Same caching strategy as /api/fleet — listCollections() over ~230 collections is the
// slow path. Cache for 60s. Cache lives on globalThis (lib/stationsCache) so save/delete
// can invalidate it after a config change.
const STATION_CACHE_MS = 60_000;
const CACHE_QUERY_MS = 20_000;

export async function loadStations(client: MongoClient): Promise<any[]> {
  const cache = getStationsCache();
  const now = Date.now();
  if (cache.data && now - cache.at < STATION_CACHE_MS) {
    return cache.data;
  }
  if (cache.promise) return cache.promise;

  cache.promise = (async () => {
    const db = client.db(STATION_DB);

    // FAST PATH: read from _stations mirror populated by the backend.
    // A failed read deliberately propagates rather than falling through: the slow
    // scan below fires 230 queries, which is the last thing an already-overloaded
    // Mongo needs. Only an empty-but-successful read means the mirror is missing.
    const docs = await db.collection('_stations').find().maxTimeMS(CACHE_QUERY_MS).toArray();
    if (docs.length > 0) {
      cache.data = docs;
      cache.at = Date.now();
      return docs;
    }

    // SLOW FALLBACK: scan per-station collections — lib/stationScan picks the canonical
    // doc per id and skips edge events stored in the same collection.
    const scan = await scanStationCollections(db);
    if (!scan.complete) {
      console.warn(`[stations] scan incomplete: ${scan.failed.length}/${scan.scanned} collection(s) could not be read (${scan.failed.slice(0, 10).join(', ')})`);
    }
    cache.data = scan.stations;
    cache.at = Date.now();
    return scan.stations;
  })();

  try {
    return await cache.promise;
  } finally {
    cache.promise = null;
  }
}
