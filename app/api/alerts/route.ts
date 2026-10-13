import { NextRequest, NextResponse } from 'next/server';
import { getMongoClient } from '@/lib/mongoClient';
import { getRequestSession, requireEditor, visibleStationIds } from '@/lib/authorization';

const STATION_DB = 'Station';

export async function GET(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const url = new URL(req.url);
    const onlyUnack = url.searchParams.get('unack') === '1';

    const client = await getMongoClient();
    const allowedIds = await visibleStationIds(session, client);
    const alerts = await client.db(STATION_DB).collection('_alerts')
      .find({ ...(onlyUnack ? { acknowledged: false } : {}), ...(allowedIds === null ? {} : { stationId: { $in: allowedIds } }) })
      .sort({ timestamp: -1 })
      .limit(200)
      .toArray();
    return NextResponse.json(alerts, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err: any) {
    console.error('[api/alerts GET] error:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const denied = await requireEditor(req);
  if (denied) return denied;
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
