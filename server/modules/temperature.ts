/**
 * Temperature — extracted from the router MQTT topic payload
 * No separate topic; data comes from router payload { tempRaw, ... }
 */

import { getState } from '../state';
import { broadcast } from '../ws';

/**
 * Called from the router message handler after payload is stored.
 * Extracts temperature and broadcasts update.
 */
export function processRouterTemp(stationId: string, payload: any): void {
  if (!payload || typeof payload !== 'object') return;

  // Router payload fields we care about
  const tempRaw   = Number(payload.temperature ?? payload.tempRaw ?? 0);
  const connstate = String(payload.connstate ?? 'Unknown');
  const rssi      = Number(payload.rssi ?? 0);
  const conntype  = String(payload.conntype ?? '');

  broadcast('temperature', stationId, {
    tempRaw,
    tempC: tempRaw / 10,
    connstate,
    rssi,
    conntype,
    timestamp: new Date().toISOString(),
  });
}
