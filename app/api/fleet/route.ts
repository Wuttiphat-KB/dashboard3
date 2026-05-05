import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';
import { MONGO_URI } from '@/lib/env';

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
  let client: MongoClient | null = null;
  try {
    client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 8000 });
    await client.connect();

    // 1. Load all station configs
    const stDb = client.db(STATION_DB);
    const cols = await stDb.listCollections().toArray();
    const stations: any[] = [];
    for (const col of cols) {
      if (col.name.startsWith('system.')) continue;
      const doc = await stDb.collection(col.name).findOne();
      if (doc && doc.id) stations.push(doc);
    }

    // 2. Load live device status + router data + script status + plc data from backend
    const [liveStatuses, routerDataDocs, scriptStatuses, plcDataDocs] = await Promise.all([
      client!.db(STATION_DB).collection('_device_status').find().toArray().catch(() => []),
      client!.db(STATION_DB).collection('_router_data').find().toArray().catch(() => []),
      client!.db(STATION_DB).collection('_script_status').find().toArray().catch(() => []),
      client!.db(STATION_DB).collection('_plc_data').find().toArray().catch(() => []),
    ]);

    // 3. For each station, fetch summary data
    const now = Date.now();
    const results = await Promise.all(stations.map(async (st) => {
      const colName = st.mongoCollections?.meter || st.name;

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
        const hbDoc = await client!.db(DATA_DBS.heartbeat).collection(colName)
          .findOne({}, { sort: { _id: -1 } }).catch(() => null);
        hbTs = hbDoc?.payload?.timestamp || null;
      }
      const hbOnline = computeOnline(hbTs);

      let rtTs: string | null = null;
      if (liveRt?.lastSeen) {
        rtTs = liveRt.lastSeen instanceof Date ? liveRt.lastSeen.toISOString() : liveRt.lastSeen;
      } else {
        const rtDoc = await client!.db(DATA_DBS.router).collection(colName)
          .findOne({}, { sort: { _id: -1 } }).catch(() => null);
        rtTs = rtDoc?.payload?.timestamp || null;
      }
      const rtOnline = computeOnline(rtTs);

      const pi5Ts = livePi5?.lastSeen
        ? (livePi5.lastSeen instanceof Date ? livePi5.lastSeen.toISOString() : livePi5.lastSeen)
        : null;
      const pi5Online = computeOnline(pi5Ts);

      // Meter latest
      const mtDoc = await client!.db(DATA_DBS.meter).collection(colName)
        .findOne({}, { sort: { _id: -1 } }).catch(() => null);
      const mp = mtDoc?.payload || {};

      // Power Module — query latest for EACH head separately
      const pmCol = client!.db(DATA_DBS.powerModule).collection(colName);
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
        : await client!.db(DATA_DBS.plc).collection(colName).findOne({}, { sort: { _id: -1 } }).catch(() => null);
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

      // Script status from backend cache
      const stScripts = scriptStatuses.filter((s: any) => s.stationId === st.id);
      const scriptFault = stScripts.find((s: any) => s.script === 'fault_status');
      const scriptPlc   = stScripts.find((s: any) => s.script === 'plc');
      const scriptOnline = (s: any) => {
        if (!s?.lastSeen) return false;
        const t = s.lastSeen instanceof Date ? s.lastSeen.getTime() : new Date(s.lastSeen).getTime();
        return !isNaN(t) && (now - t) < HB_TIMEOUT;
      };

      // Compute status
      const devices = [hbOnline, pi5Online, rtOnline];
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
        },
        powerModule: [1, 2].map(h => pmHeads[h] || { head: h, pmCount: 0, voltage: 0, current: 0, powerKw: 0, timestamp: '', online: false }),
        plcHeads,
        scripts: {
          faultStatus: { online: scriptOnline(scriptFault), lastHeartbeat: scriptFault?.lastSeen ? (scriptFault.lastSeen instanceof Date ? scriptFault.lastSeen.toISOString() : scriptFault.lastSeen) : null },
          plc:         { online: scriptOnline(scriptPlc),   lastHeartbeat: scriptPlc?.lastSeen   ? (scriptPlc.lastSeen   instanceof Date ? scriptPlc.lastSeen.toISOString()   : scriptPlc.lastSeen)   : null },
        },
      };
    }));

    return NextResponse.json(results);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    if (client) await client.close();
  }
}
