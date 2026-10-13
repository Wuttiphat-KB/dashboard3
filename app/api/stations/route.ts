import { NextRequest, NextResponse } from 'next/server';
import { getMongoClient } from '@/lib/mongoClient';
import { loadStations } from '@/lib/stationRepository';
import { getRequestSession } from '@/lib/authorization';
import { canViewStation } from '@/lib/stationAccess';

/**
 * GET /api/stations
 * Returns all station configs from MongoDB database "Station".
 * Each station is stored in its own collection (collection = station.name).
 */
export async function GET(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const t0 = Date.now();
  try {
    const client = await getMongoClient();
    const stations = (await loadStations(client)).filter(station => canViewStation(session, station));
    console.log(`[api/stations] returned ${stations.length} in ${Date.now() - t0}ms`);
    return NextResponse.json(stations, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err: any) {
    console.error('[api/stations] error:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
}
