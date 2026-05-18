/**
 * Power Module — forward MQTT data to MongoDB (database "PowerModule")
 * + broadcast via WebSocket for real-time updates.
 */

import { getState } from '../state';
import { broadcast } from '../ws';
import { onMessage } from '../mqtt';
import { getDbByName, getStationDb } from '../mongo';

const POWER_MODULE_DB = 'PowerModule';

/** stationId → collection name (from station config) */
const pmCollections = new Map<string, string>();

/**
 * Cache the latest PM head data per station in `_pm_data` (Station DB). The PM
 * payload from MQTT arrives one head at a time (`PM1` xor `PM2`), so we keep
 * head1/head2 in separate sub-docs and only overwrite the relevant one.
 *
 * Throttle is per (station, head) — a per-station throttle would drop PM1 when
 * PM2 just arrived (and vice versa), leaving one head permanently empty.
 */
const lastPmCacheAt = new Map<string, number>();  // key: `${stationId}#${head}`
const PM_CACHE_THROTTLE_MS = 5_000;

async function cachePmLatest(stationId: string, payload: any): Promise<void> {
  if (!payload || typeof payload !== 'object') return;

  const now = Date.now();
  const set: any = { stationId, updatedAt: new Date() };
  let wroteAny = false;

  for (const head of [1, 2] as const) {
    if (payload[`PM${head}`] === undefined) continue;
    const key = `${stationId}#${head}`;
    if ((now - (lastPmCacheAt.get(key) ?? 0)) < PM_CACHE_THROTTLE_MS) continue;
    lastPmCacheAt.set(key, now);

    set[`head${head}`] = {
      pmCount:     Number(payload[`PM${head}`]) || 0,
      voltage:     Number(payload[`Voltage${head}`]) || 0,
      current:     Number(payload[`Current${head}`]) || 0,
      powerKw:     (Number(payload[`Power${head}`]) || 0) / 1000,
      prevVoltage: Number(payload[`Prevoltage${head}`]) || 0,
      prevCurrent: Number(payload[`Precurrent${head}`]) || 0,
      timestamp:   payload[`timestamp${head}`] || payload.timestamp || '',
    };
    wroteAny = true;
  }

  if (!wroteAny) return;

  try {
    const db = getStationDb();
    await db.collection('_pm_data').updateOne(
      { stationId },
      { $set: set },
      { upsert: true },
    );
  } catch {
    // non-fatal
  }
}

export function registerPmStation(stationId: string, collectionName: string): void {
  const prev = pmCollections.get(stationId);
  if (collectionName) {
    pmCollections.set(stationId, collectionName);
    if (prev !== collectionName) {
      console.log(`[pm] ${stationId} → PowerModule.${collectionName}`);
    }
  } else {
    pmCollections.delete(stationId);
  }
}

// Backpressure cap — same pattern as meter.ts
const pmPending = new Map<string, number>();
const PM_PENDING_LIMIT = 50;
let pmDropCount = 0;

async function forwardPm(stationId: string, topic: string, payload: any): Promise<void> {
  const collectionName = pmCollections.get(stationId);
  if (!collectionName) {
    console.warn(`[pm] no collection configured for ${stationId} — skipping forward`);
    return;
  }

  const pending = pmPending.get(stationId) || 0;
  if (pending >= PM_PENDING_LIMIT) {
    pmDropCount++;
    if (pmDropCount % 100 === 1) {
      console.warn(`[pm] backpressure: dropping write for ${stationId} (${pending} pending, ${pmDropCount} total drops)`);
    }
    return;
  }
  pmPending.set(stationId, pending + 1);

  try {
    const db = getDbByName(POWER_MODULE_DB);
    await db.collection(collectionName).insertOne({
      topic,
      payload,
      qos: 0,
      retain: false,
      receivedAt: new Date(),
    });
  } catch (err: any) {
    console.error(`[pm] forward error (${stationId} → ${collectionName}):`, err.message);
  } finally {
    pmPending.set(stationId, (pmPending.get(stationId) || 1) - 1);
  }
}

export function initPowerModuleHandler(): void {
  onMessage('powerModule', (stationId, topic, payload) => {
    const state = getState(stationId);
    state.powerModule = payload;

    forwardPm(stationId, topic, payload);
    cachePmLatest(stationId, payload);
    broadcast('powerModule', stationId, payload);
  });
}
