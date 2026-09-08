import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';
import { getMongoClient } from '@/lib/mongoClient';
import { getStationsCache } from '@/lib/stationsCache';

const STATION_DB = 'Station';

// Same caching strategy as /api/fleet — listCollections() over ~230 collections is the
// slow path. Cache for 60s. Cache lives on globalThis (lib/stationsCache) so save/delete
// can invalidate it after a config change.
const STATION_CACHE_MS = 60_000;
const FINDONE_CONCURRENCY = 20;
const CACHE_QUERY_MS = 20_000;

async function loadStations(client: MongoClient): Promise<any[]> {
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

    // SLOW FALLBACK: scan per-station collections — pick canonical doc per id.
    const cols = await db.listCollections().toArray();
    const targets = cols.filter(c => !c.name.startsWith('system.') && !c.name.startsWith('_'));
    interface Candidate { doc: any; updatedAt: number; canonical: boolean; }
    const bestById = new Map<string, Candidate>();
    for (let i = 0; i < targets.length; i += FINDONE_CONCURRENCY) {
      const batch = targets.slice(i, i + FINDONE_CONCURRENCY);
      const results = await Promise.all(
        batch.map(async col => ({ col: col.name, doc: await db.collection(col.name).findOne().catch(() => null) })),
      );
      for (const { col, doc } of results) {
        if (!doc || !doc.id) continue;
        const cand: Candidate = {
          doc,
          updatedAt: new Date(doc.updatedAt || 0).getTime(),
          canonical: doc.name === col,
        };
        const existing = bestById.get(doc.id);
        if (!existing
          || (cand.canonical && !existing.canonical)
          || (cand.canonical === existing.canonical && cand.updatedAt > existing.updatedAt)) {
          bestById.set(doc.id, cand);
        }
      }
    }
    const out = [...bestById.values()].map(c => c.doc);
    cache.data = out;
    cache.at = Date.now();
    return out;
  })();

  try {
    return await cache.promise;
  } finally {
    cache.promise = null;
  }
}

/**
 * GET /api/stations
 * Returns all station configs from MongoDB database "Station".
 * Each station is stored in its own collection (collection = station.name).
 */
export async function GET() {
  const t0 = Date.now();
  try {
    const client = await getMongoClient();
    const stations = await loadStations(client);
    console.log(`[api/stations] returned ${stations.length} in ${Date.now() - t0}ms`);
    return NextResponse.json(stations);
  } catch (err: any) {
    console.error('[api/stations] error:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
}
