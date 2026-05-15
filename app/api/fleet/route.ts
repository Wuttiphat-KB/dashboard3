import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';
import { getMongoClient } from '@/lib/mongoClient';

const STATION_DB = 'Station';
const HB_TIMEOUT = 300_000; // 5 min

// MongoDB on this deployment has ~230 collections in Station DB, one per station.
// listCollections() + findOne()-per-collection takes ~14s end-to-end, which is the
// primary reason /api/fleet was timing out at 30s. Cache the loaded station list
// for 60s so subsequent requests skip that whole loop.
const STATION_CACHE_MS = 60_000;
const FINDONE_CONCURRENCY = 20;
let cachedStations: any[] | null = null;
let cachedStationsAt = 0;
let cachedStationsPromise: Promise<any[]> | null = null;

async function loadStations(client: MongoClient): Promise<any[]> {
  const now = Date.now();
  if (cachedStations && now - cachedStationsAt < STATION_CACHE_MS) {
    return cachedStations;
  }
  if (cachedStationsPromise) return cachedStationsPromise;

  cachedStationsPromise = (async () => {
    const stDb = client.db(STATION_DB);

    // FAST PATH: backend mirrors all station configs to `_stations` every reload.
    // Read from there — one query instead of 230 findOne()s.
    try {
      const docs = await stDb.collection('_stations').find().toArray();
      if (docs.length > 0) {
        cachedStations = docs;
        cachedStationsAt = Date.now();
        return docs;
      }
    } catch {
      // fall through to slow scan
    }

    // SLOW FALLBACK: scan per-station collections. Only used until backend has
    // populated _stations for the first time.
    const cols = await stDb.listCollections().toArray();
    const targets = cols.filter(c => !c.name.startsWith('system.') && !c.name.startsWith('_'));
    const out: any[] = [];
    const seenIds = new Set<string>();
    for (let i = 0; i < targets.length; i += FINDONE_CONCURRENCY) {
      const batch = targets.slice(i, i + FINDONE_CONCURRENCY);
      const docs = await Promise.all(
        batch.map(col => stDb.collection(col.name).findOne().catch(() => null)),
      );
      for (const doc of docs) {
        if (doc && doc.id && !seenIds.has(doc.id)) {
          seenIds.add(doc.id);
          out.push(doc);
        }
      }
    }
    cachedStations = out;
    cachedStationsAt = Date.now();
    return out;
  })();

  try {
    return await cachedStationsPromise;
  } finally {
    cachedStationsPromise = null;
  }
}

/**
 * GET /api/fleet
 * Returns stations + summary dashboard data for every station in one call.
 *
 * All data comes from `Station` DB's `_*` cache collections (populated by the
 * backend) — no queries against the per-station data DBs. This makes the call
 * O(7 queries) instead of O(800).
 */
export async function GET() {
  const t0 = Date.now();
  const phase: Record<string, number> = {};
  const mark = (name: string, since: number) => { phase[name] = Date.now() - since; };

  try {
    const tConn = Date.now();
    const client = await getMongoClient();
    mark('connect', tConn);

    // 1. Load all station configs (cached ~60s — see loadStations)
    const tCfg = Date.now();
    const fromCache = cachedStations && Date.now() - cachedStationsAt < STATION_CACHE_MS;
    const stations = await loadStations(client);
    mark(fromCache ? `stationsCached[${stations.length}]` : `stationsLoaded[${stations.length}]`, tCfg);

    // 2. Load live caches in parallel — all stations in one query each.
    // The Mongo on this deployment is too slow to do per-station queries (200 ×
    // 4 queries = 30+ minutes), so the backend is now mirroring meter + PM
    // data into _meter_latest and _pm_data, and we read everything from
    // Station DB's _* collections only.
    const tCaches = Date.now();
    const stDb = client.db(STATION_DB);
    const [
      liveStatuses,
      routerDataDocs,
      scriptStatuses,
      plcDataDocs,
      fanDataDocs,
      meterLatestDocs,
      pmDataDocs,
    ] = await Promise.all([
      stDb.collection('_device_status').find().toArray().catch(() => []),
      stDb.collection('_router_data').find().toArray().catch(() => []),
      stDb.collection('_script_status').find().toArray().catch(() => []),
      stDb.collection('_plc_data').find().toArray().catch(() => []),
      stDb.collection('_fan_data').find().toArray().catch(() => []),
      stDb.collection('_meter_latest').find().toArray().catch(() => []),
      stDb.collection('_pm_data').find().toArray().catch(() => []),
    ]);
    mark('loadCaches', tCaches);

    // Index the caches once instead of doing .find() inside the per-station loop
    const byStationId = <T extends { stationId?: string }>(arr: T[]) => {
      const m = new Map<string, T>();
      for (const d of arr) if (d.stationId) m.set(d.stationId, d);
      return m;
    };
    const routerByStation = byStationId(routerDataDocs as any[]);
    const plcByStation    = byStationId(plcDataDocs as any[]);
    const fanByStation    = byStationId(fanDataDocs as any[]);
    const meterByStation  = byStationId(meterLatestDocs as any[]);
    const pmByStation     = byStationId(pmDataDocs as any[]);
    const scriptsByStation = new Map<string, any[]>();
    for (const s of scriptStatuses as any[]) {
      if (!s.stationId) continue;
      const list = scriptsByStation.get(s.stationId) || [];
      list.push(s);
      scriptsByStation.set(s.stationId, list);
    }
    const liveByStation = new Map<string, Record<string, any>>();
    for (const d of liveStatuses as any[]) {
      if (!d.stationId) continue;
      const bag = liveByStation.get(d.stationId) || {};
      bag[d.device] = d;
      liveByStation.set(d.stationId, bag);
    }

    // 3. Build per-station summary from pre-loaded caches (NO Mongo queries here).
    const tPerStation = Date.now();
    const now = Date.now();
    const tsToIso = (ts: any): string | null => {
      if (!ts) return null;
      return ts instanceof Date ? ts.toISOString() : String(ts);
    };
    const computeOnline = (ts: string | Date | null | undefined): boolean => {
      if (!ts) return false;
      const t = ts instanceof Date ? ts.getTime() : new Date(ts).getTime();
      return !isNaN(t) && (now - t) < HB_TIMEOUT;
    };

    const results = stations.map((st) => {
      const live = liveByStation.get(st.id) || {};
      const liveHb  = live.heartbeat;
      const liveRt  = live.router;
      const livePi5 = live.heartbeatPi5;

      const hbTs  = tsToIso(liveHb?.lastSeen);
      const rtTs  = tsToIso(liveRt?.lastSeen);
      const pi5Ts = tsToIso(livePi5?.lastSeen);

      const hbOnline  = computeOnline(hbTs);
      const rtOnline  = computeOnline(rtTs);
      const pi5Online = computeOnline(pi5Ts);

      // Meter — from _meter_latest cache (backend keeps it warm)
      const meterDoc = meterByStation.get(st.id);
      const mp = meterDoc || {};
      // Stalled detection is no longer per-request — set to false; the meter
      // overview page should derive this from timestamp age instead.
      const stalled1 = false;
      const stalled2 = false;

      // Power Module — from _pm_data cache
      const pmDoc = pmByStation.get(st.id);
      const pmHeads: Record<number, any> = {};
      for (const h of [1, 2] as const) {
        const head = (pmDoc as any)?.[`head${h}`];
        if (head) {
          pmHeads[h] = {
            head: h,
            pmCount: head.pmCount || 0,
            voltage: head.voltage || 0,
            current: head.current || 0,
            powerKw: head.powerKw || 0,
            timestamp: head.timestamp || '',
            online: true,
          };
        }
      }

      // PLC — from _plc_data cache
      const plcSource = (plcByStation.get(st.id) as any)?.payload;
      const plcHeads = [1, 2].map(h => {
        if (!plcSource) return { head: h, chargeState: 'Unknown', powerKw: 0, soc: 0 };
        return {
          head: h,
          chargeState: String(plcSource[`chargeState${h}`] ?? plcSource[`H${h} chargeState`] ?? 'Unknown'),
          powerKw:     Number(plcSource[`powerKw${h}`] ?? plcSource[`H${h} powerKw`] ?? 0),
          soc:         Number(plcSource[`SOC${h}`] ?? plcSource[`H${h} SOC`] ?? 0),
        };
      });

      const routerData = routerByStation.get(st.id);
      const fanDoc = fanByStation.get(st.id);
      const fans = (fanDoc as any)?.fans || {};
      const fanTimestamp = tsToIso((fanDoc as any)?.updatedAt) || '';

      const stScripts = scriptsByStation.get(st.id) || [];
      const scriptFault = stScripts.find((s: any) => s.script === 'fault_status');
      const scriptPlc   = stScripts.find((s: any) => s.script === 'plc');
      const scriptOnline = (s: any) => computeOnline(tsToIso(s?.lastSeen));

      // Compute status — exclude Pi5 if station has no Pi5 device
      const hasPi5 = st.hasPi5 !== false;  // default true
      const devices = hasPi5 ? [hbOnline, pi5Online, rtOnline] : [hbOnline, rtOnline];
      const onlineCount = devices.filter(Boolean).length;
      const status = onlineCount === 0 ? 'offline' : onlineCount === devices.length ? 'online' : 'degraded';

      return {
        station: {
          id: st.id,
          name: st.name,
          displayName: st.displayName || st.name,
          chargerHeads: st.chargerHeads || 2,
          expectedPmPerHead: st.expectedPmPerHead || 3,
          expectedPmHead1: st.expectedPmHead1 ?? st.expectedPmPerHead ?? 3,
          expectedPmHead2: st.expectedPmHead2 ?? st.expectedPmPerHead ?? 3,
          hasPi5,
          fanBrand: st.fanBrand || 'EBM',
        },
        status,
        heartbeat: { online: hbOnline, lastSeen: hbTs || null },
        pi5:       { online: pi5Online, lastSeen: pi5Ts || null },
        router:    {
          online:    rtOnline,
          lastSeen:  rtTs || null,
          connstate: routerData?.connstate || (rtOnline ? 'Connected' : 'Disconnected'),
          tempRaw:   Number(routerData?.tempRaw ?? 0),
          rssi:      Number(routerData?.rssi ?? 0),
          conntype:  String(routerData?.conntype ?? ''),
        },
        meter: {
          meter1Wh: Number(mp.meter1 ?? 0),
          meter2Wh: Number(mp.meter2 ?? 0),
          timestamp1: mp.timestamp1 || '',
          timestamp2: mp.timestamp2 || '',
          stalled1,
          stalled2,
        },
        fan: {
          fans,                          // { "FAN 1": 4507.99, "FAN 2": ..., ... }
          timestamp: fanTimestamp,
        },
        powerModule: [1, 2].map(h => pmHeads[h] || { head: h, pmCount: 0, voltage: 0, current: 0, powerKw: 0, timestamp: '', online: false }),
        plcHeads,
        scripts: {
          faultStatus: { online: scriptOnline(scriptFault), lastHeartbeat: tsToIso(scriptFault?.lastSeen) },
          plc:         { online: scriptOnline(scriptPlc),   lastHeartbeat: tsToIso(scriptPlc?.lastSeen) },
        },
      };
    });

    mark('perStation', tPerStation);
    const total = Date.now() - t0;
    const summary = Object.entries(phase).map(([k, v]) => `${k}=${v}ms`).join(' ');
    console.log(`[api/fleet] ${summary} total=${total}ms stations=${results.length}`);
    return NextResponse.json(results);
  } catch (err: any) {
    const total = Date.now() - t0;
    const summary = Object.entries(phase).map(([k, v]) => `${k}=${v}ms`).join(' ');
    console.error(`[api/fleet] FAILED after ${total}ms ${summary} error:`, err?.message || err);
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
  // No client.close() — connection pool is shared and reused across requests.
}
