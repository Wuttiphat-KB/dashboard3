import { NextRequest, NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';
import { MONGO_URI } from '@/lib/env';

const STATION_DB = 'Station';

export async function GET() {
  let client: MongoClient | null = null;
  try {
    client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    const alerts = await client.db(STATION_DB).collection('_alerts')
      .find({ acknowledged: false })
      .sort({ timestamp: -1 })
      .limit(200)
      .toArray();
    return NextResponse.json(alerts);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    if (client) await client.close();
  }
}

export async function PATCH(req: NextRequest) {
  let client: MongoClient | null = null;
  try {
    const body = await req.json();
    const ids: string[] = body.ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'ids array required' }, { status: 400 });
    }
    client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    const result = await client.db(STATION_DB).collection('_alerts').updateMany(
      { id: { $in: ids } },
      { $set: { acknowledged: true, acknowledgedAt: new Date() } },
    );
    return NextResponse.json({ matched: result.matchedCount, modified: result.modifiedCount });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    if (client) await client.close();
  }
}
