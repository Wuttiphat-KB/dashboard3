/**
 * Power Module — Node-RED already stores to MongoDB.
 * Backend only broadcasts via WebSocket for real-time updates.
 */

import { getState } from '../state';
import { broadcast } from '../ws';
import { onMessage } from '../mqtt';

export function registerPmStation(_stationId: string, _collectionName: string): void {
  // No-op — Node-RED handles MongoDB storage
}

export function initPowerModuleHandler(): void {
  onMessage('powerModule', (stationId, _topic, payload) => {
    const state = getState(stationId);
    state.powerModule = payload;
    broadcast('powerModule', stationId, payload);
  });
}
