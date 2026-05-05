/**
 * Heartbeat module — OCPP Device, Pi5, Router
 *
 * - Tracks lastSeen per device per station
 * - 5-minute timeout → offline
 * - Falling edge (online → offline) & rising edge (offline → online) detection
 * - OCPP Device & Router: store edge events in MongoDB
 * - Pi5: alert only, no MongoDB storage
 * - All transitions: generate alert
 */

import { getStationDb } from '../mongo';
import { getState, getAllState, DeviceState } from '../state';
import { broadcast } from '../ws';
import { onMessage } from '../mqtt';
import { ENV } from '../config';

/** Write device online/offline status to MongoDB so API can read it */
async function syncDeviceStatus(stationId: string, deviceKey: string, online: boolean, lastSeen: number): Promise<void> {
  try {
    const db = getStationDb();
    await db.collection('_device_status').updateOne(
      { stationId, device: deviceKey },
      { $set: { stationId, device: deviceKey, online, lastSeen: new Date(lastSeen), updatedAt: new Date() } },
      { upsert: true },
    );
  } catch (err: any) {
    // Silent fail — non-critical
  }
}

/** Persist full router payload (temp, rssi, conntype, etc.) for API to read */
async function syncRouterData(stationId: string, payload: any): Promise<void> {
  try {
    const db = getStationDb();
    // Extract Status block (the payload may be nested under station name and "Status" key)
    let status: any = null;
    if (payload && typeof payload === 'object') {
      if (payload.Status) status = payload.Status;
      else status = payload;  // fallback: payload itself
    }
    if (!status) return;

    await db.collection('_router_data').updateOne(
      { stationId },
      {
        $set: {
          stationId,
          tempRaw:   Number(status.temp ?? 0),
          rssi:      Number(status.rssi ?? 0),
          rsrp:      Number(status.rsrp ?? 0),
          rsrq:      Number(status.rsrq ?? 0),
          sinr:      Number(status.sinr ?? 0),
          conntype:  String(status.conntype ?? ''),
          connstate: String(status.connstate ?? ''),
          operator:  String(status.operator ?? ''),
          model:     String(status.model ?? ''),
          imei:      String(status.imei ?? ''),
          iccid:     String(status.iccid ?? ''),
          ip:        Array.isArray(status.ip) ? status.ip : [],
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
  } catch (err: any) {
    // Silent fail
  }
}

type DeviceKey = 'heartbeat' | 'heartbeatPi5' | 'router';

interface EdgeEvent {
  stationId: string;
  device:    string;
  edge:      'falling' | 'rising';
  timestamp: Date;
  payload:   unknown;
}

/** Store falling/rising edge event in MongoDB */
async function storeEdge(
  stationId: string,
  collectionName: string,
  device: string,
  edge: 'falling' | 'rising',
  payload: unknown,
): Promise<void> {
  try {
    const db = getStationDb();
    const doc: EdgeEvent = {
      stationId,
      device,
      edge,
      timestamp: new Date(),
      payload,
    };
    await db.collection(collectionName).insertOne(doc);
    console.log(`[heartbeat] ${edge} edge stored → ${collectionName} (${stationId}/${device})`);
  } catch (err: any) {
    console.error(`[heartbeat] MongoDB error:`, err.message);
  }
}

/** Generate alert and broadcast */
function emitAlert(
  stationId: string,
  device: string,
  severity: 'warning' | 'critical',
  message: string,
): void {
  const alert = {
    id: `${stationId}-${device}-${Date.now()}`,
    stationId,
    type: 'heartbeat',
    severity,
    message,
    timestamp: new Date().toISOString(),
    acknowledged: false,
  };
  broadcast('alert', stationId, alert);
  console.log(`[alert] ${severity}: ${message}`);

  // TODO: Telegram notification — DISABLED for now, enable in future version
  // sendTelegram(stationId, message);

  // Store alert in MongoDB (Station DB)
  try {
    const db = getStationDb();
    db.collection('_alerts').insertOne(alert).catch(() => {});
  } catch {}
}

/** Map of stationId → collectionNames (for edge storage) */
const stationCollections = new Map<string, { heartbeatFallingEdge: string; router: string }>();

export function registerHeartbeatStation(
  stationId: string,
  collections: { heartbeatFallingEdge: string; router: string },
): void {
  stationCollections.set(stationId, collections);
}

/** Process an incoming heartbeat message */
function handleHeartbeat(deviceKey: DeviceKey, stationId: string, payload: unknown): void {
  const state = getState(stationId);
  const device: DeviceState = state[deviceKey];
  const wasOnline = device.online;

  device.lastSeen = Date.now();
  device.payload = payload;
  device.online = true;

  const deviceName = deviceKey === 'heartbeat' ? 'OCPP Device'
                   : deviceKey === 'heartbeatPi5' ? 'Pi5'
                   : 'Router';

  // Rising edge: was offline → now online
  if (!wasOnline && device.lastSeen > 0) {
    console.log(`[heartbeat] ↑ RISING EDGE: ${stationId}/${deviceName}`);
    emitAlert(stationId, deviceName, 'warning', `${stationId} ${deviceName} came ONLINE`);

    const cols = stationCollections.get(stationId);
    if (cols) {
      // OCPP Device → heartbeatFallingEdge collection (stores both edges)
      if (deviceKey === 'heartbeat') {
        storeEdge(stationId, cols.heartbeatFallingEdge, deviceName, 'rising', payload);
      }
      // Router → router collection
      if (deviceKey === 'router') {
        storeEdge(stationId, cols.router, deviceName, 'rising', payload);
      }
      // Pi5: no MongoDB storage
    }
  }

  // Sync to MongoDB for API access
  syncDeviceStatus(stationId, deviceKey, true, device.lastSeen);

  // Broadcast state update
  broadcast('heartbeat', stationId, {
    device: deviceKey,
    name: deviceName,
    online: true,
    lastSeen: new Date(device.lastSeen).toISOString(),
    payload,
  });
}

/** Check for timeouts — call this on interval */
export function checkTimeouts(): void {
  const now = Date.now();
  const timeout = ENV.HEARTBEAT_TIMEOUT_MS;

  for (const [stationId, state] of getAllState()) {
    for (const deviceKey of ['heartbeat', 'heartbeatPi5', 'router'] as DeviceKey[]) {
      const device: DeviceState = state[deviceKey];
      if (!device.online) continue;
      if (device.lastSeen === 0) continue;

      if (now - device.lastSeen > timeout) {
        device.online = false;

        const deviceName = deviceKey === 'heartbeat' ? 'OCPP Device'
                         : deviceKey === 'heartbeatPi5' ? 'Pi5'
                         : 'Router';

        console.log(`[heartbeat] ↓ FALLING EDGE: ${stationId}/${deviceName} (timeout ${timeout / 1000}s)`);
        emitAlert(stationId, deviceName, 'critical', `${stationId} ${deviceName} went OFFLINE (timeout)`);

        const cols = stationCollections.get(stationId);
        if (cols) {
          if (deviceKey === 'heartbeat') {
            storeEdge(stationId, cols.heartbeatFallingEdge, deviceName, 'falling', device.payload);
          }
          if (deviceKey === 'router') {
            storeEdge(stationId, cols.router, deviceName, 'falling', device.payload);
          }
        }

        syncDeviceStatus(stationId, deviceKey, false, device.lastSeen);

        broadcast('heartbeat', stationId, {
          device: deviceKey,
          name: deviceName,
          online: false,
          lastSeen: new Date(device.lastSeen).toISOString(),
        });
      }
    }
  }
}

/** Register MQTT handlers */
export function initHeartbeatHandlers(): void {
  onMessage('heartbeat', (stationId, _topic, payload) => {
    handleHeartbeat('heartbeat', stationId, payload);
  });

  onMessage('heartbeatPi5', (stationId, _topic, payload) => {
    handleHeartbeat('heartbeatPi5', stationId, payload);
  });

  onMessage('router', (stationId, _topic, payload) => {
    handleHeartbeat('router', stationId, payload);

    // Also extract router data (temp, connstate, etc.) into state
    const state = getState(stationId);
    state.router.payload = payload;

    // Persist router data (temp, rssi, etc.) for API
    syncRouterData(stationId, payload);
  });
}
