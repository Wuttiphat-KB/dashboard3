/**
 * Fan RPM — receive fan RPM data from MQTT, broadcast to frontend,
 * and persist latest snapshot to MongoDB Station._fan_data for API access.
 */

import { getState } from '../state';
import { broadcast } from '../ws';
import { onMessage } from '../mqtt';
import { getStationDb } from '../mongo';

async function syncFanData(stationId: string, payload: any): Promise<void> {
  if (!payload || typeof payload !== 'object') return;
  try {
    const db = getStationDb();
    await db.collection('_fan_data').updateOne(
      { stationId },
      {
        $set: {
          stationId,
          fans: payload,
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
  } catch {
    // silent
  }
}

export function initFanRpmHandler(): void {
  onMessage('fanRPM', (stationId, _topic, payload) => {
    const state = getState(stationId);
    state.fanRpm = payload;

    syncFanData(stationId, payload);

    broadcast('fanRpm', stationId, {
      fans: payload,
      timestamp: new Date().toISOString(),
    });
  });
}
