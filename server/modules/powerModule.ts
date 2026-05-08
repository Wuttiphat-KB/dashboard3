/**
 * Power Module — forward MQTT data to MongoDB (database "PowerModule")
 * + broadcast via WebSocket for real-time updates.
 */

import { getState } from '../state';
import { broadcast } from '../ws';
import { onMessage } from '../mqtt';
import { getDbByName } from '../mongo';

const POWER_MODULE_DB = 'PowerModule';

/** stationId → collection name (from station config) */
const pmCollections = new Map<string, string>();

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

async function forwardPm(stationId: string, topic: string, payload: any): Promise<void> {
  const collectionName = pmCollections.get(stationId);
  if (!collectionName) {
    console.warn(`[pm] no collection configured for ${stationId} — skipping forward`);
    return;
  }
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
  }
}

export function initPowerModuleHandler(): void {
  onMessage('powerModule', (stationId, topic, payload) => {
    const state = getState(stationId);
    state.powerModule = payload;

    forwardPm(stationId, topic, payload);
    broadcast('powerModule', stationId, payload);
  });
}
