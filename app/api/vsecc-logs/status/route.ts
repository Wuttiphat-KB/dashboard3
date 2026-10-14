import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession } from '@/lib/authorization';
import { getMongoClient } from '@/lib/mongoClient';
import { loadStations } from '@/lib/stationRepository';
import { collectorOverview } from '@/lib/vseccStore';

/** GET /api/vsecc-logs/status → background log collector status for every Vector station (admins only). */
export async function GET(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const stations = await loadStations(await getMongoClient());
  return NextResponse.json(await collectorOverview(stations), { headers: { 'Cache-Control': 'private, no-store' } });
}
