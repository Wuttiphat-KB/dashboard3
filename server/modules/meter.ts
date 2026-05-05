/**
 * Meter module — Node-RED already stores to MongoDB.
 * Backend only broadcasts via WebSocket for real-time updates.
 */

import { getState } from '../state';
import { broadcast } from '../ws';
import { onMessage } from '../mqtt';

export function registerMeterStation(_stationId: string, _collectionName: string): void {
  // No-op — Node-RED handles MongoDB storage
}

export function initMeterHandler(): void {
  onMessage('meter', (stationId, _topic, payload) => {
    const state = getState(stationId);
    state.meter = payload;
    broadcast('meter', stationId, payload);
  });
}
