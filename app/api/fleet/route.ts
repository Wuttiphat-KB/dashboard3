import { NextResponse } from 'next/server';
import { getMongoClient } from '@/lib/mongoClient';

const STATION_DB = 'Station';
const HB_TIMEOUT = 300_000; // 5 min

const DATA_DBS = {
  heartbeat:   'Heartbeat',
  powerModule: 'PowerModule',
  meter:       'meter',
  router:      'Router',
  plc:         'PlcDatabase',
} as const;

/**
 * GET /api/fleet
 * Returns stations + summary dashboard data for every station in one call.
 */
export async function GET() {
  const t0 = Date.now();
  const phase: Record<string, number> = {};
  const mark = (name: string, since: number) => { phase[name] = Date.now() - since; };

  try {
    const tConn = Date.now();
    const client = await getMongoClient();
    mark('connect', tConn);

    // 1. Load all station configs (skip internal cache collections + dedupe by id)
    const tCfg = Date.now();
    const stDb = client.db(STATION_DB);
    const cols = await stDb.listCollections().toArray();
    mark('listCollections', tCfg);

    const tFindStations = Date.now();
    const stations: any[] = [];
    const seenIds = new Set<string>();
    for (const col of cols) {
      if (col.name.startsWith('system.') || col.name.startsWith('_')) continue;
      const doc = await stDb.collection(col.name).findOne();
      if (doc && doc.id && !seenIds.has(doc.id)) {
        seenIds.add(doc.id);
        stations.push(doc);
      }
    }
    mark(`findStations[${stations.length}/${cols.length}]`, tFindStations);

    // 2. Load live device status + router data + script status + plc data + fan data
    const tCaches = Date.now();
    const [liveStatuses, routerDataDocs, scriptStatuses, plcDataDocs, fanDataDocs] = await Promise.all([
      client!.db(STATION_DB).collection('_device_status').find().toArray().catch(() => []),
      client!.db(STATION_DB).collection('_router_data').find().toArray().catch(() => []),
      client!.db(STATION_DB).collection('_script_status').find().toArray().catch(() => []),
      client!.db(STATION_DB).collection('_plc_data').find().toArray().catch(() => []),
      client!.db(STATION_DB).collection('_fan_data').find().toArray().catch(() => []),
    ]);
    mark('loadCaches', tCaches);

    // 3. For each station, fetch summary data
    const tPerStation = Date.now();
    const now = Date.now();
    const results = await Promise.all(stations.map(async (st) => {
      // Per-database collection name (each db may use a different collection per station)
      const cols = st.mongoCollections || {};
      const colHeartbeat = cols.heartbeatFallingEdge || st.name;
      const colMeter     = cols.meter       || st.name;
      const colPM        = cols.powerModule || st.name;
      const colRouter    = cols.router      || st.name;
      const colPlc       = cols.statePlc    || st.name;

      // Heartbeat — prefer live status from backend, fallback to MongoDB
      const liveHb = liveStatuses.find((d: any) => d.stationId === st.id && d.device === 'heartbeat');
      const liveRt = liveStatuses.find((d: any) => d.stationId === st.id && d.device === 'router');
      const livePi5 = liveStatuses.find((d: any) => d.stationId === st.id && d.device === 'heartbeatPi5');

      // Helper: device is online ONLY if message arrived within HB_TIMEOUT
      // Don't trust the cached `online` flag in MongoDB — check timestamp age instead
      const computeOnline = (ts: string | Date | null | undefined): boolean => {
        if (!ts) return false;
        const t = ts instanceof Date ? ts.getTime() : new Date(ts).getTime();
        return !isNaN(t) && (now - t) < HB_TIMEOUT;
      };

      let hbTs: string | null = null;
      if (liveHb?.lastSeen) {
        hbTs = liveHb.lastSeen instanceof Date ? liveHb.lastSeen.toISOString() : liveHb.lastSeen;
      } else {
        const hbDoc = await client!.db(DATA_DBS.heartbeat).collection(colHeartbeat)
          .findOne({}, { sort: { _id: -1 } }).catch(() => null);
        hbTs = hbDoc?.payload?.timestamp || null;
      }
      const hbOnline = computeOnline(hbTs);

      let rtTs: string | null = null;
      if (liveRt?.lastSeen) {
        rtTs = liveRt.lastSeen instanceof Date ? liveRt.lastSeen.toISOString() : liveRt.lastSeen;
      } else {
        const rtDoc = await client!.db(DATA_DBS.router).collection(colRouter)
          .findOne({}, { sort: { _id: -1 } }).catch(() => null);
        rtTs = rtDoc?.payload?.timestamp || null;
      }
      const rtOnline = computeOnline(rtTs);

      const pi5Ts = livePi5?.lastSeen
        ? (livePi5.lastSeen instanceof Date ? livePi5.lastSeen.toISOString() : livePi5.lastSeen)
        : null;
      const pi5Online = computeOnline(pi5Ts);

      // Meter — latest + one from > 2 days ago for stalled detection
      const meterCol = client!.db(DATA_DBS.meter).collection(colMeter);
      const cutoff = new Date(Date.now() - 2 * 86_400_000);
      const [mtDoc, mtOldDoc] = await Promise.all([
        meterCol.findOne({}, { sort: { _id: -1 } }).catch(() => null),
        meterCol.findOne({ receivedAt: { $lte: cutoff } }, { sort: { receivedAt: -1 } }).catch(() => null),
      ]);
      const mp = mtDoc?.payload || {};
      const mpOld = mtOldDoc?.payload || null;
      const stationHeads = Number(st.chargerHeads) || 2;
      // Stalled = value at >2 days ago is the same as current value
      // For single-head stations, ignore meter2 (always false)
      const stalled1 = mpOld != null && Number(mpOld.meter1 ?? 0) === Number(mp.meter1 ?? 0);
      const stalled2 = stationHeads >= 2 && mpOld != null && Number(mpOld.meter2 ?? 0) === Number(mp.meter2 ?? 0);

      // Power Module — query latest for EACH head separately
      const pmCol = client!.db(DATA_DBS.powerModule).collection(colPM);
      const [pm1Doc, pm2Doc] = await Promise.all([
        pmCol.findOne({ 'payload.PM1': { $exists: true } }, { sort: { _id: -1 } }).catch(() => null),
        pmCol.findOne({ 'payload.PM2': { $exists: true } }, { sort: { _id: -1 } }).catch(() => null),
      ]);
      const pmHeads: Record<number, any> = {};
      for (const [h, doc] of [[1, pm1Doc], [2, pm2Doc]] as const) {
        if (!doc) continue;
        const p = doc.payload || {};
        pmHeads[h] = {
          head: h,
          pmCount: Number(p[`PM${h}`]) || 0,
          voltage: Number(p[`Voltage${h}`]) || 0,
          current: Number(p[`Current${h}`]) || 0,
          powerKw: (Number(p[`Power${h}`]) || 0) / 1000,
          timestamp: p[`timestamp${h}`] || p.timestamp || '',
          online: true,
        };
      }

      // PLC — prefer live data (from MQTT cache), fallback to MongoDB PlcDatabase
      const plcLive = plcDataDocs.find((d: any) => d.stationId === st.id)?.payload;
      const plcDoc = plcLive
        ? null  // live data takes precedence
        : await client!.db(DATA_DBS.plc).collection(colPlc).findOne({}, { sort: { _id: -1 } }).catch(() => null);
      const plcSource = plcLive || plcDoc;
      const plcHeads = [1, 2].map(h => {
        if (!plcSource) return { head: h, chargeState: 'Unknown', powerKw: 0, soc: 0 };
        return {
          head: h,
          chargeState: String(plcSource[`chargeState${h}`] ?? plcSource[`H${h} chargeState`] ?? 'Unknown'),
          powerKw:     Number(plcSource[`powerKw${h}`] ?? plcSource[`H${h} powerKw`] ?? 0),
          soc:         Number(plcSource[`SOC${h}`] ?? plcSource[`H${h} SOC`] ?? 0),
        };
      });

      // Router data (temp, rssi, etc.) from backend cache
      const routerData = routerDataDocs.find((d: any) => d.stationId === st.id);

      // Fan data — latest snapshot from backend cache
      const fanDoc = fanDataDocs.find((d: any) => d.stationId === st.id);
      const fans = fanDoc?.fans || {};
      const fanTimestamp = fanDoc?.updatedAt
        ? (fanDoc.updatedAt instanceof Date ? fanDoc.updatedAt.toISOString() : String(fanDoc.updatedAt))
        : '';

      // Script status from backend cache
      const stScripts = scriptStatuses.filter((s: any) => s.stationId === st.id);
      const scriptFault = stScripts.find((s: any) => s.script === 'fault_status');
      const scriptPlc   = stScripts.find((s: any) => s.script === 'plc');
      const scriptOnline = (s: any) => {
        if (!s?.lastSeen) return false;
        const t = s.lastSeen instanceof Date ? s.lastSeen.getTime() : new Date(s.lastSeen).getTime();
        return !isNaN(t) && (now - t) < HB_TIMEOUT;
      };

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
          faultStatus: { online: scriptOnline(scriptFault), lastHeartbeat: scriptFault?.lastSeen ? (scriptFault.lastSeen instanceof Date ? scriptFault.lastSeen.toISOString() : scriptFault.lastSeen) : null },
          plc:         { online: scriptOnline(scriptPlc),   lastHeartbeat: scriptPlc?.lastSeen   ? (scriptPlc.lastSeen   instanceof Date ? scriptPlc.lastSeen.toISOString()   : scriptPlc.lastSeen)   : null },
        },
      };
    }));

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
