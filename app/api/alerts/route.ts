import { NextRequest, NextResponse } from 'next/server';
import { getMongoClient } from '@/lib/mongoClient';

const STATION_DB = 'Station';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const onlyUnack = url.searchParams.get('unack') === '1';

    const client = await getMongoClient();
    const alerts = await client.db(STATION_DB).collection('_alerts')
      .find(onlyUnack ? { acknowledged: false } : {})
      .sort({ timestamp: -1 })
      .limit(200)
      .toArray();
    return NextResponse.json(alerts);
  } catch (err: any) {
    console.error('[api/alerts GET] error:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const ids: string[] = body.ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'ids array required' }, { status: 400 });
    }
    const client = await getMongoClient();
    const result = await client.db(STATION_DB).collection('_alerts').updateMany(
      { id: { $in: ids } },
      { $set: { acknowledged: true, acknowledgedAt: new Date() } },
    );
    return NextResponse.json({ matched: result.matchedCount, modified: result.modifiedCount });
  } catch (err: any) {
    console.error('[api/alerts PATCH] error:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
}
