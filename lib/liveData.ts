/**
 * When cached telemetry may still be shown as a station's current state.
 *
 * The backend keeps the LAST payload each station sent in the Station DB `_*`
 * caches (`_plc_data`, `_pm_data`, …) and nothing ever clears them. A cabinet
 * that drops off the network mid-charge therefore leaves "Charging · 90 kW"
 * in the cache indefinitely. /api/fleet and /api/dashboard/[id] apply these
 * rules before handing those values to the UI.
 */

/** Same 5-minute window as the heartbeat LEDs and the backend's PLC-script timeout. */
export const LIVE_TIMEOUT_MS = 300_000;

export type StationStatus = 'online' | 'degraded' | 'offline';

/** True when `ts` (Date, epoch ms or date string) is less than `maxAgeMs` old. Missing or unparseable → false. */
export function isRecent(ts: unknown, now: number = Date.now(), maxAgeMs: number = LIVE_TIMEOUT_MS): boolean {
  if (ts === null || ts === undefined || ts === '') return false;
  const t = ts instanceof Date ? ts.getTime()
    : typeof ts === 'number' ? ts
    : new Date(String(ts)).getTime();
  return !Number.isNaN(t) && now - t < maxAgeMs;
}

/** No heartbeat device online → offline, all online → online, otherwise degraded. */
export function stationStatus(devicesOnline: boolean[]): StationStatus {
  const online = devicesOnline.filter(Boolean).length;
  if (online === 0) return 'offline';
  return online === devicesOnline.length ? 'online' : 'degraded';
}

/**
 * The charge state to report instead of a cached PLC payload, or null when the
 * payload is live and can be shown as-is:
 *   'Offline' — the station itself is offline
 *   'Unknown' — the station is reachable, but no PLC payload arrived within the
 *               live window (PLC script or Pi5 down), or none ever did
 */
export function stalePlcState(
  status: StationStatus,
  plcUpdatedAt: unknown,
  now: number = Date.now(),
): 'Offline' | 'Unknown' | null {
  if (status === 'offline') return 'Offline';
  return isRecent(plcUpdatedAt, now) ? null : 'Unknown';
}
