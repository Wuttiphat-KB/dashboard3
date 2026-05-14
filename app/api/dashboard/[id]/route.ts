import { NextRequest, NextResponse } from 'next/server';
import { getMongoClient } from '@/lib/mongoClient';

const STATION_DB = 'Station';

// Real MongoDB structure: separate databases per data type, collection = station name
const DATA_DBS = {
  heartbeat:    'Heartbeat',
  powerModule:  'PowerModule',
  meter:        'meter',
  router:       'Router',
  faultStatus:  'FaultStatus',
  plc:          'PlcDatabase',
} as const;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const client = await getMongoClient();

    // 1. Find station config from db=Station
    // FAST PATH: backend mirrors all configs to _stations, single index-friendly query.
    const stationDb = client.db(STATION_DB);
    let stationConfig: any = await stationDb.collection('_stations').findOne({
      $or: [{ id }, { name: id }],
    }).catch(() => null);

    // SLOW FALLBACK: scan per-station collections (only if backend hasn't populated _stations yet)
    if (!stationConfig) {
      const allCols = await stationDb.listCollections().toArray();
      for (const col of allCols) {
        if (col.name.startsWith('system.') || col.name.startsWith('_')) continue;
        const doc = await stationDb.collection(col.name).findOne({
          $or: [{ id }, { name: id }],
        });
        if (doc) { stationConfig = doc; break; }
      }
    }

    if (!stationConfig) {
      return NextResponse.json({ error: `Station ${id} not found` }, { status: 404 });
    }

    // Per-database collection name (each db may use a different collection)
    const cols = stationConfig.mongoCollections || {};
    const colHeartbeat = cols.heartbeatFallingEdge || stationConfig.name;
    const colMeter     = cols.meter       || stationConfig.name;
    const colPM        = cols.powerModule || stationConfig.name;
    const colRouter    = cols.router      || stationConfig.name;
    const colPlc       = cols.statePlc    || stationConfig.name;

    // 2. Fetch data from each database in parallel
    const [
      heartbeatDocs,
      meterDocs,
      pm1Doc,
      pm2Doc,
      routerDocs,
      plcDoc,
    ] = await Promise.all([
      // Heartbeat — latest 50 for edge history
      client.db(DATA_DBS.heartbeat).collection(colHeartbeat)
        .find().sort({ _id: -1 }).limit(50).toArray()
        .catch(() => []),

      // Meter — latest 200 for charts
      client.db(DATA_DBS.meter).collection(colMeter)
        .find().sort({ _id: -1 }).limit(200).toArray()
        .catch(() => []),

      // PM head 1 (latest doc that contains PM1)
      client.db(DATA_DBS.powerModule).collection(colPM)
        .findOne({ 'payload.PM1': { $exists: true } }, { sort: { _id: -1 } })
        .catch(() => null),

      // PM head 2 (latest doc that contains PM2)
      client.db(DATA_DBS.powerModule).collection(colPM)
        .findOne({ 'payload.PM2': { $exists: true } }, { sort: { _id: -1 } })
        .catch(() => null),

      // Router — latest 50
      client.db(DATA_DBS.router).collection(colRouter)
        .find().sort({ _id: -1 }).limit(50).toArray()
        .catch(() => []),

      // PLC — latest 1
      client.db(DATA_DBS.plc).collection(colPlc)
        .findOne({}, { sort: { _id: -1 } })
        .catch(() => null),
    ]);

    // Live device status + router data + script status + plc payload + fan data from backend
    const [liveStatuses, routerLive, scriptStatuses, plcLive, fanLive] = await Promise.all([
      client.db(STATION_DB).collection('_device_status').find({ stationId: id }).toArray().catch(() => []),
      client.db(STATION_DB).collection('_router_data').findOne({ stationId: id }).catch(() => null),
      client.db(STATION_DB).collection('_script_status').find({ stationId: id }).toArray().catch(() => []),
      client.db(STATION_DB).collection('_plc_data').findOne({ stationId: id }).catch(() => null),
      client.db(STATION_DB).collection('_fan_data').findOne({ stationId: id }).catch(() => null),
    ]);
    const liveHb = liveStatuses.find((d: any) => d.device === 'heartbeat');
    const liveRt = liveStatuses.find((d: any) => d.device === 'router');
    const livePi5 = liveStatuses.find((d: any) => d.device === 'heartbeatPi5');
    const scriptFaultStatus = scriptStatuses.find((s: any) => s.script === 'fault_status');
    const scriptPlc         = scriptStatuses.find((s: any) => s.script === 'plc');

    const HB_TIMEOUT_MS = 300_000;
    const computeOnline = (ts: string | Date | null | undefined): boolean => {
      if (!ts) return false;
      const t = ts instanceof Date ? ts.getTime() : new Date(ts).getTime();
      return !isNaN(t) && (Date.now() - t) < HB_TIMEOUT_MS;
    };
    const tsToString = (ts: any): string | null => {
      if (!ts) return null;
      return ts instanceof Date ? ts.toISOString() : String(ts);
    };

    // 3. Parse heartbeat — prefer live status, fallback to MongoDB
    const hbTimestamp = liveHb?.lastSeen
      ? tsToString(liveHb.lastSeen)
      : (heartbeatDocs[0]?.payload?.timestamp || null);
    const hbOnline = computeOnline(hbTimestamp);

    const pi5Timestamp = tsToString(livePi5?.lastSeen);
    const pi5Online = computeOnline(pi5Timestamp);

    const rtTimestamp = liveRt?.lastSeen
      ? tsToString(liveRt.lastSeen)
      : (routerDocs[0]?.payload?.timestamp || null);
    const rtOnline = computeOnline(rtTimestamp);

    // 4. Parse meter — extract from payload field
    const meterHistory = meterDocs.reverse().map((doc: any) => {
      const p = doc.payload || doc;
      return {
        meter1Wh:   Number(p.meter1 ?? 0),
        meter2Wh:   Number(p.meter2 ?? 0),
        timestamp1: p.timestamp1 || '',
        timestamp2: p.timestamp2 || '',
        timestamp:  p.timestamp || '',
      };
    });

    // 5. Parse power module — latest doc fetched per head
    const pmByHead: Record<number, any> = {};
    for (const [head, doc] of [[1, pm1Doc], [2, pm2Doc]] as const) {
      if (!doc) continue;
      const p = (doc as any).payload || doc;
      pmByHead[head] = {
        head,
        pmCount:     Number(p[`PM${head}`]) || 0,
        voltage:     Number(p[`Voltage${head}`]) || 0,
        current:     Number(p[`Current${head}`]) || 0,
        powerKw:     (Number(p[`Power${head}`]) || 0) / 1000,
        prevVoltage: Number(p[`Prevoltage${head}`]) || 0,
        prevCurrent: Number(p[`Precurrent${head}`]) || 0,
        timestamp:   p[`timestamp${head}`] || p.timestamp || '',
        online:      true,
      };
    }
    const powerModuleHeads = [1, 2].map(h => pmByHead[h] || {
      head: h, pmCount: 0, voltage: 0, current: 0, powerKw: 0,
      prevVoltage: 0, prevCurrent: 0, timestamp: '', online: false,
    });

    // 6. Router parsing handled above with live status

    // 7. Parse PLC — prefer live data from backend MQTT cache
    let plcData = null;
    const plcSource = plcLive?.payload || plcDoc;
    if (plcSource) {
      const p = plcSource;
      plcData = {
        head1: {
          head: 1,
          chargeState:     String(p['chargeState1'] ?? p['H1 chargeState'] ?? 'Unknown'),
          soc:             Number(p['SOC1'] ?? p['H1 SOC'] ?? 0),
          powerKw:         Number(p['powerKw1'] ?? p['H1 powerKw'] ?? 0),
          presentVoltage:  Number(p['presentVoltage1'] ?? 0),
          presentCurrent:  Number(p['presentCurrent1'] ?? 0),
          temp1Head:       Number(p['temp1Head1'] ?? 0),
          temp2Head:       Number(p['temp2Head1'] ?? 0),
          tempPowerModule: Number(p['tempPowerModule1'] ?? 0),
          fanStatus:       Number(p['fanStatus1'] ?? 0),
          headError:       Number(p['head1Error'] ?? p['H1 Error'] ?? 0),
          errorMessage:    String(p['errorMessage1'] ?? ''),
          activeMld:       Number(p['activeMld1'] ?? 0),
        },
        head2: {
          head: 2,
          chargeState:     String(p['chargeState2'] ?? p['H2 chargeState'] ?? 'Unknown'),
          soc:             Number(p['SOC2'] ?? p['H2 SOC'] ?? 0),
          powerKw:         Number(p['powerKw2'] ?? p['H2 powerKw'] ?? 0),
          presentVoltage:  Number(p['presentVoltage2'] ?? 0),
          presentCurrent:  Number(p['presentCurrent2'] ?? 0),
          temp1Head:       Number(p['temp1Head2'] ?? 0),
          temp2Head:       Number(p['temp2Head2'] ?? 0),
          tempPowerModule: Number(p['tempPowerModule2'] ?? 0),
          fanStatus:       Number(p['fanStatus2'] ?? 0),
          headError:       Number(p['head2Error'] ?? p['H2 Error'] ?? 0),
          errorMessage:    String(p['errorMessage2'] ?? ''),
          activeMld:       Number(p['activeMld2'] ?? 0),
        },
        timestamp: p.timestamp || '',
      };
    }

    // 8. Alerts (from Station DB)
    const alerts = await client.db(STATION_DB).collection('_alerts')
      .find({ stationId: id, acknowledged: false })
      .sort({ timestamp: -1 }).limit(50).toArray()
      .catch(() => []);

    return NextResponse.json({
      station: stationConfig,
      heartbeat: {
        online: hbOnline,
        lastSeen: hbTimestamp,
        edgeHistory: heartbeatDocs.slice(0, 20),
      },
      pi5: {
        online: pi5Online,
        lastSeen: pi5Timestamp,
      },
      meterHistory,
      powerModuleHeads,
      routerData: {
        online: rtOnline,
        lastSeen: rtTimestamp,
        connstate: routerLive?.connstate || (rtOnline ? 'Connected' : 'Disconnected'),
        tempRaw:  Number(routerLive?.tempRaw ?? 0),
        rssi:     Number(routerLive?.rssi ?? 0),
        rsrp:     Number(routerLive?.rsrp ?? 0),
        rsrq:     Number(routerLive?.rsrq ?? 0),
        sinr:     Number(routerLive?.sinr ?? 0),
        conntype: String(routerLive?.conntype ?? ''),
        operator: String(routerLive?.operator ?? ''),
        model:    String(routerLive?.model ?? ''),
        imei:     String(routerLive?.imei ?? ''),
        iccid:    String(routerLive?.iccid ?? ''),
        ip:       Array.isArray(routerLive?.ip) ? routerLive.ip : [],
      },
      plcData,
      fanData: {
        fans: (fanLive as any)?.fans || {},
        timestamp: tsToString((fanLive as any)?.updatedAt) || '',
      },
      scripts: [
        {
          name: 'fault_status',
          description: 'Fault status heartbeat',
          mqttTopic: '',
          online:   computeOnline(scriptFaultStatus?.lastSeen),
          lastHeartbeat: tsToString(scriptFaultStatus?.lastSeen) || '',
          expectedInterval: 30,
        },
        {
          name: 'plc',
          description: 'PLC data heartbeat (timeout from PLC topic)',
          mqttTopic: '',
          online:   computeOnline(scriptPlc?.lastSeen),
          lastHeartbeat: tsToString(scriptPlc?.lastSeen) || '',
          expectedInterval: 30,
        },
      ],
      alerts,
    });
  } catch (err: any) {
    console.error('[api/dashboard] error:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
  // No client.close() — connection pool is shared and reused across requests.
}
