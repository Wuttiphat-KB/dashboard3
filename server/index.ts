/**
 * EV Monitor Backend Server
 *
 * - Loads station configs from MongoDB (db=Station)
 * - Falls back to MOCK_STATIONS if MongoDB has none
 * - Connects to MQTT broker → subscribes to all station topics
 * - Connects to MongoDB → stores edge events, meter, power module data
 * - Runs WebSocket server → pushes real-time updates to frontend
 * - Checks heartbeat timeouts every 30s
 */

import { ENV } from './config';
import { connectMongo, getStationDb, getDbByName } from './mongo';
import { connectMqtt, registerStation, unregisterStation } from './mqtt';
import { startWs } from './ws';
import { initHeartbeatHandlers, registerHeartbeatStation, checkTimeouts } from './modules/heartbeat';
import { initMeterHandler, registerMeterStation } from './modules/meter';
import { initPowerModuleHandler, registerPmStation } from './modules/powerModule';
import { processRouterTemp } from './modules/temperature';
import { initFanRpmHandler } from './modules/fanRpm';
import { initScriptHbHandlers, checkScriptTimeouts, registerStatePlcCollection } from './modules/scriptHb';
import { checkAllAlerts } from './modules/alerts';
import { onMessage } from './mqtt';
import { MOCK_STATIONS } from '../lib/mockData';

const STATION_DB = 'Station';

interface StationConfig {
  id: string;
  name: string;
  displayName: string;
  mqttTopics: {
    heartbeat: string;
    heartbeatPi5: string;
    router: string;
    meter: string;
    powerModule: string;
    faultStatus: string;
    plc: string;
    fanRPM: string;
    [key: string]: string;
  };
  mongoCollections: {
    powerModule: string;
    meter: string;
    heartbeatFallingEdge: string;
    router: string;
  };
  [key: string]: any;
}

/** Load station configs from MongoDB db=Station — uses the shared connection + parallel findOne */
const STATIONS_LOAD_CONCURRENCY = 20;
async function loadStationsFromMongo(opts?: { forceSlowScan?: boolean }): Promise<StationConfig[]> {
  try {
    const db = getStationDb();

    // FAST PATH: read from `_stations` mirror if it's already been populated by a
    // previous run. Skipped when forceSlowScan=true so startup can reconcile
    // any per-station collections that were added without touching _stations.
    if (!opts?.forceSlowScan) {
      try {
        const mirrored = await db.collection('_stations').find().toArray();
        if (mirrored.length > 0) {
          return mirrored.filter(d => d.id && d.mqttTopics) as unknown as StationConfig[];
        }
      } catch {
        // fall through to slow scan
      }
    }

    // SLOW PATH: list per-station collections, findOne each, in parallel batches.
    const collections = await db.listCollections().toArray();
    const targets = collections.filter(c => !c.name.startsWith('system.') && !c.name.startsWith('_'));
    const stations: StationConfig[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < targets.length; i += STATIONS_LOAD_CONCURRENCY) {
      const batch = targets.slice(i, i + STATIONS_LOAD_CONCURRENCY);
      const docs = await Promise.all(
        batch.map(col => db.collection(col.name).findOne().catch(() => null)),
      );
      for (const doc of docs) {
        if (doc && doc.id && doc.mqttTopics && !seen.has(doc.id)) {
          seen.add(doc.id);
          stations.push(doc as unknown as StationConfig);
        }
      }
    }
    return stations;
  } catch (err: any) {
    console.error(`[init] Failed to load stations from MongoDB:`, err.message);
    return [];
  }
}

/**
 * Mirror the freshly-loaded station list into a single `_stations` collection so the
 * Next.js API can read all configs in one query instead of doing listCollections() +
 * findOne() over ~230 per-station collections (which was taking 10+ minutes here).
 *
 * Guarded against re-entrancy — on this slow Mongo, a single sync can take 2+
 * minutes, and stacking concurrent ones makes everything worse.
 */
let syncStationsInflight = false;
let lastSyncSignature = '';

async function syncStationsMeta(stations: StationConfig[]): Promise<void> {
  if (stations.length === 0) return;
  if (syncStationsInflight) {
    console.log('[init] syncStationsMeta skipped — previous sync still running');
    return;
  }
  // Skip if the list hasn't actually changed since the last successful sync
  const sig = stations.map(s => `${s.id}:${JSON.stringify(s.mqttTopics)}`).sort().join('|');
  if (sig === lastSyncSignature) return;

  syncStationsInflight = true;
  try {
    const db = getStationDb();
    const ops = stations.map(st => {
      const { _id, ...rest } = st as any;
      return {
        updateOne: {
          filter: { id: st.id },
          update: { $set: { ...rest, syncedAt: new Date() } },
          upsert: true,
        },
      } as const;
    });
    const tStart = Date.now();
    await db.collection('_stations').bulkWrite(ops, { ordered: false });
    // Drop any stations no longer in the latest list
    const ids = stations.map(s => s.id);
    await db.collection('_stations').deleteMany({ id: { $nin: ids } });
    lastSyncSignature = sig;
    console.log(`[init] synced ${stations.length} stations → _stations in ${Date.now() - tStart}ms`);
  } catch (err: any) {
    console.error('[init] syncStationsMeta failed:', err?.message || err);
  } finally {
    syncStationsInflight = false;
  }
}

/**
 * One-shot seed of `_pm_data` and `_meter_latest` from per-station data
 * collections. Without this, after a backend restart the caches sit empty until
 * each station happens to broadcast — and some stations only send PM1 / PM2
 * every few hours, so the dashboard would show "modules missing" for a long
 * time even though the data is right there in Mongo.
 *
 * Runs in the background (fire-and-forget) so it doesn't delay startup.
 */
const SEED_CONCURRENCY = 10;
async function seedPmAndMeterCaches(stations: StationConfig[]): Promise<void> {
  const tStart = Date.now();
  const stDb = getStationDb();
  const pmDb = getDbByName('PowerModule');
  const meterDb = getDbByName('meter');
  let pmSeeded = 0;
  let meterSeeded = 0;

  for (let i = 0; i < stations.length; i += SEED_CONCURRENCY) {
    const batch = stations.slice(i, i + SEED_CONCURRENCY);
    await Promise.all(batch.map(async (st) => {
      const colPm    = st.mongoCollections?.powerModule || st.name;
      const colMeter = st.mongoCollections?.meter       || st.name;

      // ── Power Module: latest doc that has PM1 + latest that has PM2 ──
      try {
        const [pm1Doc, pm2Doc] = await Promise.all([
          pmDb.collection(colPm).findOne({ 'payload.PM1': { $exists: true } }, { sort: { _id: -1 } }).catch(() => null),
          pmDb.collection(colPm).findOne({ 'payload.PM2': { $exists: true } }, { sort: { _id: -1 } }).catch(() => null),
        ]);
        const set: any = { stationId: st.id, updatedAt: new Date() };
        for (const [h, doc] of [[1, pm1Doc], [2, pm2Doc]] as const) {
          if (!doc) continue;
          const p: any = (doc as any).payload || {};
          set[`head${h}`] = {
            pmCount:     Number(p[`PM${h}`]) || 0,
            voltage:     Number(p[`Voltage${h}`]) || 0,
            current:     Number(p[`Current${h}`]) || 0,
            powerKw:     (Number(p[`Power${h}`]) || 0) / 1000,
            prevVoltage: Number(p[`Prevoltage${h}`]) || 0,
            prevCurrent: Number(p[`Precurrent${h}`]) || 0,
            timestamp:   p[`timestamp${h}`] || p.timestamp || '',
          };
        }
        // Only write if at least one head was found — and DON'T overwrite a
        // newer live cache entry that may have arrived via MQTT while seeding.
        if (set.head1 || set.head2) {
          const existing = await stDb.collection('_pm_data').findOne({ stationId: st.id }).catch(() => null);
          const merged: any = { stationId: st.id, updatedAt: new Date() };
          for (const h of [1, 2] as const) {
            merged[`head${h}`] = (existing as any)?.[`head${h}`] ?? set[`head${h}`];
          }
          await stDb.collection('_pm_data').updateOne(
            { stationId: st.id },
            { $set: merged },
            { upsert: true },
          );
          pmSeeded++;
        }
      } catch {}

      // ── Meter: latest doc ──
      try {
        const mDoc = await meterDb.collection(colMeter).findOne({}, { sort: { _id: -1 } }).catch(() => null);
        if (mDoc) {
          const p: any = (mDoc as any).payload || {};
          const existing = await stDb.collection('_meter_latest').findOne({ stationId: st.id }).catch(() => null);
          // MQTT-fed cache wins if it already exists (it's newer than seed).
          if (!existing) {
            await stDb.collection('_meter_latest').updateOne(
              { stationId: st.id },
              {
                $set: {
                  stationId: st.id,
                  meter1:     Number(p.meter1 ?? 0),
                  meter2:     Number(p.meter2 ?? 0),
                  timestamp1: p.timestamp1 || '',
                  timestamp2: p.timestamp2 || '',
                  timestamp:  p.timestamp || '',
                  updatedAt:  new Date(),
                },
              },
              { upsert: true },
            );
            meterSeeded++;
          }
        }
      } catch {}
    }));
  }

  console.log(`[init] seeded caches in ${Date.now() - tStart}ms — _pm_data:${pmSeeded} _meter_latest:${meterSeeded}`);
}

function registerStationConfig(station: StationConfig): void {
  const { mqttTopics, mongoCollections } = station;

  registerStation(station.id, {
    heartbeat:    mqttTopics.heartbeat,
    heartbeatPi5: mqttTopics.heartbeatPi5,
    router:       mqttTopics.router,
    meter:        mqttTopics.meter,
    powerModule:  mqttTopics.powerModule,
    faultStatus:  mqttTopics.faultStatus,
    plc:          mqttTopics.plc,
    fanRPM:       mqttTopics.fanRPM,
  });

  registerHeartbeatStation(station.id, {
    heartbeatFallingEdge: mongoCollections.heartbeatFallingEdge,
    router: mongoCollections.router,
  });
  registerMeterStation(station.id, mongoCollections.meter);
  registerPmStation(station.id, mongoCollections.powerModule);
  registerStatePlcCollection(station.id, (mongoCollections as any).statePlc || '');
}

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  EV Monitor Backend');
  console.log('═══════════════════════════════════════════');
  console.log(`  MQTT:  ${ENV.MQTT_URL}`);
  console.log(`  Mongo: ${ENV.MONGO_URI}`);
  console.log(`  WS:    port ${ENV.WS_PORT}`);
  console.log(`  HB timeout: ${ENV.HEARTBEAT_TIMEOUT_MS / 1000}s`);
  console.log('═══════════════════════════════════════════\n');

  // 1. Connect MongoDB (for data storage — db=ev_monitor)
  await connectMongo();

  // 2. Start WebSocket server
  startWs();

  // 3. Register MQTT message handlers (before connecting)
  initHeartbeatHandlers();
  initMeterHandler();
  initPowerModuleHandler();
  initFanRpmHandler();
  initScriptHbHandlers();

  // Router also feeds temperature module
  onMessage('router', (stationId, _topic, payload) => {
    processRouterTemp(stationId, payload);
  });

  // 4. Connect MQTT
  connectMqtt();

  // 5. Load station configs from MongoDB (db=Station)
  //    Fall back to MOCK_STATIONS if none found.
  //    forceSlowScan: bypass _stations cache on startup so any per-station
  //    collection that was added without touching _stations gets picked up.
  let stations = await loadStationsFromMongo({ forceSlowScan: true });

  if (stations.length === 0) {
    console.log('[init] No stations in MongoDB db=Station, using MOCK_STATIONS as fallback');
    stations = MOCK_STATIONS as unknown as StationConfig[];
  } else {
    console.log(`[init] Loaded ${stations.length} stations from MongoDB db=${STATION_DB}`);
  }

  // Track currently registered station configs (for diff detection)
  const registeredConfigs = new Map<string, string>();  // stationId → JSON.stringify(mqttTopics)

  function topicSignature(st: StationConfig): string {
    return JSON.stringify(st.mqttTopics || {});
  }

  // 6. Register all initial stations
  for (const station of stations) {
    registerStationConfig(station);
    registeredConfigs.set(station.id, topicSignature(station));
    console.log(`  ✓ ${station.id} (${station.displayName || station.name})`);
  }

  // Mirror to _stations so the Next.js API can avoid the slow per-collection scan
  await syncStationsMeta(stations);

  // Fire-and-forget — populate _pm_data and _meter_latest in the background
  // so the dashboard has values even before MQTT messages arrive for each head.
  seedPmAndMeterCaches(stations).catch(err =>
    console.error('[init] seedPmAndMeterCaches failed:', err?.message || err),
  );

  console.log(`\n[init] ${stations.length} stations registered (seeding caches in background)\n`);

  // 7. Timeout checker (every 30s)
  setInterval(() => {
    checkTimeouts();
    checkScriptTimeouts();
  }, 30_000);

  // 7b. Auto-alert engine (every 60s) — temp / meter stalled / PM count / script offline
  setInterval(() => { checkAllAlerts(); }, 60_000);
  // Initial run after 15s (let MQTT data populate first)
  setTimeout(() => { checkAllAlerts(); }, 15_000);

  // 8. Auto-reload stations every 60s — handles add / edit / delete.
  // (Previously 10s, but on a slow Mongo each reload + sync can take 2+ minutes,
  //  so 10s caused dozens of concurrent reloads stacking up.)
  let reloadInflight = false;
  setInterval(async () => {
    if (reloadInflight) return;
    reloadInflight = true;
    try {
      const latest = await loadStationsFromMongo();
      const latestIds = new Set(latest.map(s => s.id));

      // Add new stations + update edited ones
      for (const st of latest) {
        const sig = topicSignature(st);
        const oldSig = registeredConfigs.get(st.id);
        if (!oldSig) {
          registerStationConfig(st);
          registeredConfigs.set(st.id, sig);
          console.log(`[init] + added: ${st.id} (${st.displayName || st.name})`);
        } else if (oldSig !== sig) {
          // Topics changed — unregister + re-register
          unregisterStation(st.id);
          registerStationConfig(st);
          registeredConfigs.set(st.id, sig);
          console.log(`[init] ↻ updated: ${st.id} (topics changed)`);
        }
      }

      // Remove deleted stations
      for (const id of registeredConfigs.keys()) {
        if (!latestIds.has(id)) {
          unregisterStation(id);
          registeredConfigs.delete(id);
          console.log(`[init] − removed: ${id}`);
        }
      }

      // Refresh _stations mirror so Next.js API stays up to date
      await syncStationsMeta(latest);
    } catch (err: any) {
      console.error('[init] reload error:', err.message);
    } finally {
      reloadInflight = false;
    }
  }, 60_000);

  console.log('[init] Heartbeat timeout checker running (30s interval)');
  console.log('[init] Station auto-reload running (60s interval — picks up add/edit/delete)');
  console.log('[init] Backend ready\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
