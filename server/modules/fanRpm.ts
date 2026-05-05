/**
 * Fan RPM — receive fan RPM data from MQTT, broadcast to frontend
 * No MongoDB storage needed; real-time display only.
 */

import { getState } from '../state';
import { broadcast } from '../ws';
import { onMessage } from '../mqtt';

export function initFanRpmHandler(): void {
  onMessage('fanRPM', (stationId, _topic, payload) => {
    const state = getState(stationId);
    state.fanRpm = payload;

    broadcast('fanRpm', stationId, {
      fans: payload,
      timestamp: new Date().toISOString(),
    });
  });
}
