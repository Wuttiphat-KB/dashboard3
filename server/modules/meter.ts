/**
 * Meter — forward MQTT data to MongoDB (database "meter")
 * + broadcast via WebSocket for real-time updates.
 */

import { getState } from '../state';
import { broadcast } from '../ws';
import { onMessage } from '../mqtt';
import { getDbByName, getStationDb } from '../mongo';

const METER_DB = 'meter';

/** stationId → collection name (from station config) */
const meterCollections = new Map<string, string>();

/**
 * Cache latest meter snapshot per station in `_meter_latest` (Station DB) so the
 * /api/fleet handler can read all 200 station meters from one collection
 * instead of doing 200 findOne()s against the per-station meter collections.
 *
 * Throttled to 1 write per station per 5s — meter messages can arrive faster
 * than that and we don't need sub-second freshness for the dashboard.
 */
const lastMeterCacheAt = new Map<string, number>();
const METER_CACHE_THROTTLE_MS = 5_000;

async function cacheMeterLatest(stationId: string, payload: any): Promise<void> {
  const now = Date.now();
  if ((now - (lastMeterCacheAt.get(stationId) ?? 0)) < METER_CACHE_THROTTLE_MS) return;
  lastMeterCacheAt.set(stationId, now);
  try {
    const db = getStationDb();
    await db.collection('_meter_latest').updateOne(
      { stationId },
      {
        $set: {
          stationId,
          meter1:     Number(payload?.meter1 ?? 0),
          meter2:     Number(payload?.meter2 ?? 0),
          timestamp1: payload?.timestamp1 || '',
          timestamp2: payload?.timestamp2 || '',
          timestamp:  payload?.timestamp || '',
          updatedAt:  new Date(),
        },
      },
      { upsert: true },
    );
  } catch {
    // non-fatal
  }
}

export function registerMeterStation(stationId: string, collectionName: string): void {
  const prev = meterCollections.get(stationId);
  if (collectionName) {
    meterCollections.set(stationId, collectionName);
    if (prev !== collectionName) {
      console.log(`[meter] ${stationId} → meter.${collectionName}`);
    }
  } else {
    meterCollections.delete(stationId);
  }
}

async function forwardMeter(stationId: string, topic: string, payload: any): Promise<void> {
  const collectionName = meterCollections.get(stationId);
  if (!collectionName) {
    console.warn(`[meter] no collection configured for ${stationId} — skipping forward`);
    return;
  }
  try {
    const db = getDbByName(METER_DB);
    await db.collection(collectionName).insertOne({
      topic,
      payload,
      qos: 0,
      retain: false,
      receivedAt: new Date(),
    });
  } catch (err: any) {
    console.error(`[meter] forward error (${stationId} → ${collectionName}):`, err.message);
  }
}

export function initMeterHandler(): void {
  onMessage('meter', (stationId, topic, payload) => {
    const state = getState(stationId);
    state.meter = payload;

    forwardMeter(stationId, topic, payload);
    cacheMeterLatest(stationId, payload);
    broadcast('meter', stationId, payload);
  });
}
