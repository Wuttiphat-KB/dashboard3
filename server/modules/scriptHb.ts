/**
 * Script heartbeat — only 2 scripts:
 *   1. fault_status  → from faultStatus topic
 *   2. plc           → timeout counted from PLC topic (no separate topic)
 */

import { getState, getAllState, DeviceState } from '../state';
import { broadcast } from '../ws';
import { onMessage } from '../mqtt';
import { ENV } from '../config';
import { getStationDb, getDbByName } from '../mongo';

/** stationId → StatePLC collection name (from station config) */
const statePlcCollections = new Map<string, string>();

/** stationId → last forwarded values (for change-detection filter) */
const lastForwardedPlc = new Map<string, Record<string, unknown>>();

export function registerStatePlcCollection(stationId: string, collectionName: string): void {
  if (collectionName) statePlcCollections.set(stationId, collectionName);
  else statePlcCollections.delete(stationId);
}

/** Persist script status to MongoDB so API can read it */
async function syncScriptStatus(stationId: string, script: string, online: boolean, lastSeen: number): Promise<void> {
  try {
    const db = getStationDb();
    await db.collection('_script_status').updateOne(
      { stationId, script },
      { $set: { stationId, script, online, lastSeen: new Date(lastSeen), updatedAt: new Date() } },
      { upsert: true },
    );
  } catch {
    // silent
  }
}

/** Persist latest PLC payload (cache for API charge state lookup) */
async function syncPlcData(stationId: string, payload: any): Promise<void> {
  try {
    const db = getStationDb();
    await db.collection('_plc_data').updateOne(
      { stationId },
      { $set: { stationId, payload, updatedAt: new Date() } },
      { upsert: true },
    );
  } catch {
    // silent
  }
}

/**
 * Forward full PLC payload to StatePLC database — ONLY when values changed.
 * Compares all keys except `timestamp` against last forwarded snapshot.
 */
async function forwardPlcToStatePlc(stationId: string, payload: any): Promise<void> {
  const collectionName = statePlcCollections.get(stationId);
  if (!collectionName) return;
  if (!payload || typeof payload !== 'object') return;

  const current = payload as Record<string, unknown>;
  const last = lastForwardedPlc.get(stationId) || {};

  // Detect change in any field except `timestamp`
  let hasChange = false;
  for (const key in current) {
    if (key === 'timestamp') continue;
    if (last[key] !== current[key]) {
      hasChange = true;
      break;
    }
  }
  if (!hasChange) return;

  // Update snapshot (excluding timestamp)
  const snapshot: Record<string, unknown> = {};
  for (const key in current) {
    if (key !== 'timestamp') snapshot[key] = current[key];
  }
  lastForwardedPlc.set(stationId, snapshot);

  try {
    const db = getDbByName('StatePLC');
    await db.collection(collectionName).insertOne({
      ...current,
      stationId,
      receivedAt: new Date(),
    });
  } catch (err: any) {
    console.error(`[plc] StatePLC forward error (${stationId}):`, err.message);
  }
}

export function initScriptHbHandlers(): void {
  // fault_status script heartbeat
  onMessage('faultStatus', (stationId, _topic, payload) => {
    const state = getState(stationId);
    state.faultStatusHb.online = true;
    state.faultStatusHb.lastSeen = Date.now();
    state.faultStatusHb.payload = payload;

    syncScriptStatus(stationId, 'fault_status', true, state.faultStatusHb.lastSeen);

    broadcast('scriptHb', stationId, {
      script: 'fault_status',
      online: true,
      lastSeen: new Date().toISOString(),
    });
  });

  // PLC script heartbeat — derived from PLC topic arrival
  onMessage('plc', (stationId, _topic, payload) => {
    const state = getState(stationId);

    // Update PLC data
    state.plc = payload;

    // Mark PLC script as alive
    state.plcScriptHb.online = true;
    state.plcScriptHb.lastSeen = Date.now();
    state.plcScriptHb.payload = payload;

    // Extract charge state per head
    if (payload && typeof payload === 'object') {
      const p = payload as any;
      state.chargeHead1 = {
        chargeState: String(p.chargeState1 ?? 'Unknown'),
        powerKw:     Number(p.powerKw1 ?? 0),
        soc:         Number(p.SOC1 ?? 0),
      };
      state.chargeHead2 = {
        chargeState: String(p.chargeState2 ?? 'Unknown'),
        powerKw:     Number(p.powerKw2 ?? 0),
        soc:         Number(p.SOC2 ?? 0),
      };
    }

    syncScriptStatus(stationId, 'plc', true, state.plcScriptHb.lastSeen);
    syncPlcData(stationId, payload);
    forwardPlcToStatePlc(stationId, payload);

    broadcast('plc', stationId, payload);
    broadcast('scriptHb', stationId, {
      script: 'plc',
      online: true,
      lastSeen: new Date().toISOString(),
    });
  });
}

/** Check script heartbeat timeouts — call on interval */
export function checkScriptTimeouts(): void {
  const now = Date.now();
  const timeout = ENV.HEARTBEAT_TIMEOUT_MS;

  for (const [stationId, state] of getAllState()) {
    for (const [key, name] of [['faultStatusHb', 'fault_status'], ['plcScriptHb', 'plc']] as const) {
      const dev: DeviceState = state[key];
      if (!dev.online || dev.lastSeen === 0) continue;
      if (now - dev.lastSeen > timeout) {
        dev.online = false;

        syncScriptStatus(stationId, name, false, dev.lastSeen);

        broadcast('scriptHb', stationId, {
          script: name,
          online: false,
          lastSeen: new Date(dev.lastSeen).toISOString(),
        });
        console.log(`[scriptHb] ${stationId}/${name} timed out`);
      }
    }
  }
}
