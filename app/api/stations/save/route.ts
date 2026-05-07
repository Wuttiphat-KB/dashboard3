import { NextRequest, NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';
import { cookies } from 'next/headers';
import { MONGO_URI } from '@/lib/env';

const STATION_DB = 'Station';
const COOKIE_NAME = 'cfg_pin';

/**
 * POST /api/stations/save
 * Saves station config to MongoDB database "Station", collection = station.name
 * Requires valid cfg_pin cookie if CONFIG_PIN env is set.
 */
export async function POST(req: NextRequest) {
  try {
    // Auth check — require valid PIN cookie when CONFIG_PIN is configured
    const expectedPin = process.env.CONFIG_PIN || '';
    if (expectedPin) {
      const jar = await cookies();
      if (jar.get(COOKIE_NAME)?.value !== expectedPin) {
        return NextResponse.json({ error: 'PIN required' }, { status: 401 });
      }
    }

    const station = await req.json();

    if (!station.name) {
      return NextResponse.json({ error: 'station.name is required' }, { status: 400 });
    }

    // Strip MongoDB-managed fields — these can't be in $set
    const { _id, ...stationData } = station;

    const client = new MongoClient(MONGO_URI);
    await client.connect();

    const db = client.db(STATION_DB);
    const collectionName = station.name;

    // Upsert the station config document (use station.id as unique key)
    await db.collection(collectionName).updateOne(
      { id: station.id },
      { $set: { ...stationData, updatedAt: new Date() } },
      { upsert: true },
    );

    await client.close();

    return NextResponse.json({ ok: true, db: STATION_DB, collection: collectionName });
  } catch (err: any) {
    console.error('[api/stations/save] error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
