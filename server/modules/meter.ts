/**
 * Meter — forward MQTT data to MongoDB (database "meter")
 * + broadcast via WebSocket for real-time updates.
 */

import { getState } from '../state';
import { broadcast } from '../ws';
import { onMessage } from '../mqtt';
import { getDbByName } from '../mongo';

const METER_DB = 'meter';

/** stationId → collection name (from station config) */
const meterCollections = new Map<string, string>();

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
    broadcast('meter', stationId, payload);
  });
}
