import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';
import { MONGO_URI } from '@/lib/env';

const STATION_DB = 'Station';

/**
 * GET /api/stations
 * Returns all station configs from MongoDB database "Station".
 * Each station is stored in its own collection (collection = station.name),
 * so we list all collections and read the first document from each.
 */
export async function GET() {
  try {
    const client = new MongoClient(MONGO_URI);
    await client.connect();

    const db = client.db(STATION_DB);
    const collections = await db.listCollections().toArray();

    const stations = [];
    for (const col of collections) {
      // Skip system collections
      if (col.name.startsWith('system.')) continue;
      const doc = await db.collection(col.name).findOne();
      if (doc && doc.id) {
        stations.push(doc);
      }
    }

    await client.close();
    return NextResponse.json(stations);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
