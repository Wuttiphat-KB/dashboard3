import { NextRequest, NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://EDS:EV1@45.91.135.9:27017/';
const STATION_DB = 'Station';

/**
 * POST /api/stations/save
 * Saves station config to MongoDB database "Station", collection = station.name
 */
export async function POST(req: NextRequest) {
  try {
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
