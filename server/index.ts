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

import { MongoClient } from 'mongodb';
import { ENV } from './config';
import { connectMongo } from './mongo';
import { connectMqtt, registerStation, unregisterStation } from './mqtt';
import { startWs } from './ws';
import { initHeartbeatHandlers, registerHeartbeatStation, checkTimeouts } from './modules/heartbeat';
import { initMeterHandler, registerMeterStation } from './modules/meter';
import { initPowerModuleHandler, registerPmStation } from './modules/powerModule';
import { processRouterTemp } from './modules/temperature';
import { initFanRpmHandler } from './modules/fanRpm';
import { initScriptHbHandlers, checkScriptTimeouts, registerStatePlcCollection } from './modules/scriptHb';
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

/** Load station configs from MongoDB db=Station */
async function loadStationsFromMongo(): Promise<StationConfig[]> {
  try {
    const client = new MongoClient(ENV.MONGO_URI);
    await client.connect();
    const db = client.db(STATION_DB);
    const collections = await db.listCollections().toArray();

    const stations: StationConfig[] = [];
    for (const col of collections) {
      if (col.name.startsWith('system.')) continue;
      const doc = await db.collection(col.name).findOne();
      if (doc && doc.id && doc.mqttTopics) {
        stations.push(doc as unknown as StationConfig);
      }
    }
    await client.close();
    return stations;
  } catch (err: any) {
    console.error(`[init] Failed to load stations from MongoDB:`, err.message);
    return [];
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

  console.log(`\n[init] ${stations.length} stations registered\n`);

  // 7. Timeout checker (every 30s)
  setInterval(() => {
    checkTimeouts();
    checkScriptTimeouts();
  }, 30_000);

  // 8. Auto-reload stations every 10s — handles add / edit / delete
  setInterval(async () => {
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
    } catch (err: any) {
      console.error('[init] reload error:', err.message);
    }
  }, 10_000);

  console.log('[init] Heartbeat timeout checker running (30s interval)');
  console.log('[init] Station auto-reload running (10s interval — picks up add/edit/delete)');
  console.log('[init] Backend ready\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
