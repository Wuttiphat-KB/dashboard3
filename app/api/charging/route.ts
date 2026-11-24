import { NextRequest, NextResponse } from 'next/server';
import { getMongoClient } from '@/lib/mongoClient';
import { getRequestSession, visibleStationIds } from '@/lib/authorization';
import { cachedResponse } from '@/lib/apiCache';
import { loadStations } from '@/lib/stationRepository';
import { isRecent, stationStatus, stalePlcState } from '@/lib/liveData';
import { headFromPlc, type ChargingStation } from '@/lib/charging';

const STATION_DB = 'Station';

// Shared response cache (lib/apiCache): one rebuild per TTL however many tabs
// have the Charging page open, and a slow Mongo delays freshness, never the page.
const CHARGING_TTL_MS       = 5_000;
const CHARGING_MAX_STALE_MS = 60_000;
/** One-row-per-station cache collections; anything near this means Mongo is in trouble. */
const CACHE_QUERY_MS        = 20_000;

const toIso = (v: unknown): string | null => {
  if (!v) return null;
  const t = v instanceof Date ? v.getTime() : new Date(String(v)).getTime();
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

/**
 * Live charging state of every head, from the backend's `_plc_data` cache (last
 * PLC payload per station) plus `_device_status` (heartbeats). Same rules as
 * /api/fleet: an offline station's heads read 'Offline', a stale PLC feed 'Unknown'.
 * Separate from /api/fleet so the extra per-head fields don't grow the payload
 * every other page downloads.
 */
async function buildCharging(): Promise<ChargingStation[]> {
  const client = await getMongoClient();
  const stations = await loadStations(client);
  const db = client.db(STATION_DB);
  const [statuses, plcDocs] = await Promise.all([
    // Not caught: online/offline comes from this, and swallowing a failure would
    // show the whole fleet as offline (same reasoning as /api/fleet).
    db.collection('_device_status').find().maxTimeMS(CACHE_QUERY_MS).toArray(),
    db.collection('_plc_data').find().maxTimeMS(CACHE_QUERY_MS).toArray().catch(() => []),
  ]);

  // stationId → device ('heartbeat' | 'heartbeatPi5' | 'router') → last seen
  const lastSeenByStation = new Map<string, Record<string, unknown>>();
  for (const d of statuses) {
    if (!d.stationId) continue;
    const bag = lastSeenByStation.get(d.stationId) || {};
    bag[d.device] = d.lastSeen;
    lastSeenByStation.set(d.stationId, bag);
  }
  const plcByStation = new Map(plcDocs.filter(d => d.stationId).map(d => [d.stationId as string, d]));

  const now = Date.now();
  return stations.map((st): ChargingStation => {
    const lastSeen = lastSeenByStation.get(st.id) || {};
    const online = (device: string) => isRecent(lastSeen[device], now);
    const hasPi5 = st.hasPi5 !== false;  // default true
    const status = stationStatus(hasPi5
      ? [online('heartbeat'), online('heartbeatPi5'), online('router')]
      : [online('heartbeat'), online('router')]);

    const plcDoc = plcByStation.get(st.id);
    const deadState = stalePlcState(status, plcDoc?.updatedAt, now);
    const payload = deadState ? null : (plcDoc?.payload ?? null);
    const numHeads = Math.min(Math.max(Number(st.chargerHeads) || 2, 1), 2);  // PLC reports heads 1–2

    return {
      station: {
        id: st.id,
        name: st.name,
        displayName: st.displayName || st.name || st.id,
        zerotierIp: st.zerotierIp || '',  // same field /api/fleet sends; feeds the copy button
        chargerHeads: numHeads,
      },
      status,
      live: payload !== null,
      updatedAt: toIso(plcDoc?.updatedAt),
      heads: Array.from({ length: numHeads }, (_, i) => headFromPlc(payload, i + 1, deadState ?? 'Unknown')),
    };
  });
}

/**
 * GET /api/charging — per-head charge state, SOC, power, voltage/current for every
 * visible station. Customer accounts get only their own stations.
 */
export async function GET(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { data, state, ageMs } = await cachedResponse<string>(
      'charging', CHARGING_TTL_MS, CHARGING_MAX_STALE_MS,
      async () => JSON.stringify(await buildCharging()),
    );
    // The cache holds every station; scoped accounts get a filtered copy.
    const allowedIds = await visibleStationIds(session, await getMongoClient());
    const body = allowedIds === null
      ? data
      : JSON.stringify((JSON.parse(data) as ChargingStation[]).filter(r => allowedIds.includes(r.station.id)));
    return new NextResponse(body, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'private, no-store',
        'X-Charging-Cache': `${state};age=${ageMs}ms`,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/charging] error:', message);
    return NextResponse.json({ error: message || 'Unknown error' }, { status: 500 });
  }
}
