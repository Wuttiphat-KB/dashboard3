import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getMongoClient } from '@/lib/mongoClient';
import { invalidateFleetCache } from '@/lib/fleetCache';

const STATION_DB = 'Station';
const COOKIE_NAME = 'cfg_pin';

/**
 * POST /api/stations/delete
 *
 * Removes a station from:
 *   - `_stations` mirror (drives /api/fleet + the backend's auto-reload)
 *   - `Station.{name}` per-station collection (the config doc)
 *   - All `_*` caches keyed by stationId (pm/meter/router/etc)
 *
 * Does NOT drop the per-station data collections in the other DBs
 * (meter, PowerModule, Router…) so historical data stays available.
 */
export async function POST(req: NextRequest) {
  try {
    // Auth check — same PIN gate as /save
    const expectedPin = process.env.CONFIG_PIN || '';
    if (expectedPin) {
      const jar = await cookies();
      if (jar.get(COOKIE_NAME)?.value !== expectedPin) {
        return NextResponse.json({ error: 'PIN required' }, { status: 401 });
      }
    }

    const body = await req.json();
    const id = String(body?.id || '').trim();
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const client = await getMongoClient();
    const db = client.db(STATION_DB);

    // Look up the station so we know its per-station collection name.
    const existing = await db.collection('_stations').findOne({ id });
    const collectionName = String(existing?.name || id);

    // Remove the config doc from the per-station collection, then drop the
    // collection itself if it's empty (it normally contains a single doc).
    try {
      await db.collection(collectionName).deleteMany({ id }).catch(() => {});
      const remaining = await db.collection(collectionName).countDocuments().catch(() => 1);
      if (remaining === 0) {
        await db.collection(collectionName).drop().catch(() => {});
      }
    } catch {}

    // Remove from all internal mirrors / caches keyed by stationId.
    const cacheCollections = [
      '_stations',
      '_pm_data',
      '_meter_latest',
      '_router_data',
      '_device_status',
      '_script_status',
      '_plc_data',
      '_fan_data',
      '_charge_daily',
    ];
    await Promise.all(cacheCollections.map(name =>
      db.collection(name).deleteMany({ stationId: id }).catch(() => null),
    ));
    // `_stations` uses `id` as the unique key, not `stationId`
    await db.collection('_stations').deleteMany({ id }).catch(() => {});

    invalidateFleetCache();

    return NextResponse.json({ ok: true, id, collection: collectionName });
  } catch (err: any) {
    console.error('[api/stations/delete] error:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
}
