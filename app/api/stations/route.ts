import { NextResponse } from 'next/server';
import { getMongoClient } from '@/lib/mongoClient';

const STATION_DB = 'Station';

/**
 * GET /api/stations
 * Returns all station configs from MongoDB database "Station".
 * Each station is stored in its own collection (collection = station.name),
 * so we list all collections and read the first document from each.
 */
export async function GET() {
  try {
    const client = await getMongoClient();

    const db = client.db(STATION_DB);
    const collections = await db.listCollections().toArray();

    const stations = [];
    const seenIds = new Set<string>();
    for (const col of collections) {
      // Skip system + internal cache collections (start with underscore)
      if (col.name.startsWith('system.') || col.name.startsWith('_')) continue;
      const doc = await db.collection(col.name).findOne();
      if (doc && doc.id && !seenIds.has(doc.id)) {
        seenIds.add(doc.id);
        stations.push(doc);
      }
    }

    return NextResponse.json(stations);
  } catch (err: any) {
    console.error('[api/stations] error:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
}
