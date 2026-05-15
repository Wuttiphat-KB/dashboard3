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
import { connectMongo, getStationDb } from './mongo';
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
async function loadStationsFromMongo(): Promise<StationConfig[]> {
  try {
    const db = getStationDb();

    // FAST PATH: read from `_stations` mirror if it's already been populated by a
    // previous run. Skips the slow per-collection scan entirely.
    try {
      const mirrored = await db.collection('_stations').find().toArray();
      if (mirrored.length > 0) {
        return mirrored.filter(d => d.id && d.mqttTopics) as unknown as StationConfig[];
      }
    } catch {
      // fall through to slow scan
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
  //    Fall back to MOCK_STATIONS if none found
  let stations = await loadStationsFromMongo();

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

  console.log(`\n[init] ${stations.length} stations registered\n`);

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
