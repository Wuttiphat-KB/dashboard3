/**
 * Auto-alert engine — periodic checks for system anomalies.
 *
 * Alert types:
 *   1. temperature   — router temp ≥ 80°C
 *   2. meter         — meter value unchanged > 2 days
 *   3. power         — PM count < expectedPmHead{N}
 *   4. script        — fault_status / plc script offline > 5 min
 *
 * Heartbeat alerts are emitted directly from heartbeat.ts (rising/falling edge).
 *
 * Dedupe strategy: each (stationId, alertKey) is tracked in `activeAlerts`.
 * Same alert isn't re-emitted while condition persists. When condition clears,
 * key is removed and alert can fire again next time.
 */

import { getStationDb, getDbByName } from '../mongo';
import { broadcast } from '../ws';

const STATION_DB = 'Station';
const PM_DB = 'PowerModule';
const METER_DB = 'meter';

const TEMP_THRESHOLD_C = 80;
const TEMP_HYSTERESIS  = 5;        // clear alert when temp drops below 75
const METER_STALL_MS   = 2 * 86_400_000;
const SCRIPT_TIMEOUT_MS = 300_000;

/** Active alerts — keyed by `${stationId}:${alertKey}` */
const activeAlerts = new Set<string>();

/**
 * Repopulate activeAlerts from MongoDB on startup. Without this, every backend
 * restart re-emits every existing alert (and re-broadcasts them to clients),
 * because the in-memory dedupe set is empty.
 */
export async function loadActiveAlertsFromDb(): Promise<void> {
  try {
    const docs = await getStationDb().collection('_alerts')
      .find({ acknowledged: false })
      .toArray();
    activeAlerts.clear();
    for (const d of docs as any[]) {
      if (d.stationId && d.alertKey) {
        activeAlerts.add(`${d.stationId}:${d.alertKey}`);
      }
    }
    console.log(`[alerts] restored ${activeAlerts.size} active alerts from MongoDB`);
  } catch (err: any) {
    console.error('[alerts] loadActiveAlertsFromDb failed:', err?.message || err);
  }
}

interface AlertSpec {
  stationId:  string;
  type:       'temperature' | 'meter' | 'power' | 'script';
  severity:   'warning' | 'critical';
  message:    string;
  alertKey:   string;
}

async function emitAlertOnce(spec: AlertSpec): Promise<void> {
  const fullKey = `${spec.stationId}:${spec.alertKey}`;
  if (activeAlerts.has(fullKey)) return;
  activeAlerts.add(fullKey);

  const alert = {
    id:           `${spec.stationId}-${spec.type}-${Date.now()}`,
    stationId:    spec.stationId,
    type:         spec.type,
    severity:     spec.severity,
    message:      spec.message,
    timestamp:    new Date().toISOString(),
    acknowledged: false,
    alertKey:     spec.alertKey,
  };

  console.log(`[alert] ${spec.severity}: ${spec.message}`);
  broadcast('alert', spec.stationId, alert);

  try {
    await getStationDb().collection('_alerts').insertOne(alert);
  } catch (err: any) {
    console.error('[alerts] insert error:', err.message);
  }
}

function clearAlert(stationId: string, alertKey: string): void {
  activeAlerts.delete(`${stationId}:${alertKey}`);
}

/** Load all station configs (for thresholds, expectedPmHead, etc.)
 *  Reads from `_stations` mirror (populated by server/index.ts) — a single
 *  fast query instead of scanning ~230 per-station collections every minute.
 */
async function loadStations(): Promise<any[]> {
  const db = getStationDb();
  return db.collection('_stations').find().toArray().catch(() => []);
}

// ── Individual checks ───────────────────────────────────────────

async function checkTemperature(stationId: string): Promise<void> {
  try {
    const db = getStationDb();
    const r = await db.collection('_router_data').findOne({ stationId });
    if (!r) return;
    const tempC = (Number(r.tempRaw) || 0) / 10;
    const key = 'temperature';

    if (tempC >= TEMP_THRESHOLD_C) {
      await emitAlertOnce({
        stationId, type: 'temperature', severity: 'critical', alertKey: key,
        message: `${stationId} router temperature ${tempC.toFixed(1)}°C — exceeded ${TEMP_THRESHOLD_C}°C threshold`,
      });
    } else if (tempC < TEMP_THRESHOLD_C - TEMP_HYSTERESIS) {
      clearAlert(stationId, key);
    }
  } catch {}
}

async function checkMeterStalled(stationId: string, collectionName: string, numHeads: number): Promise<void> {
  if (!collectionName) return;
  try {
    const col = getDbByName(METER_DB).collection(collectionName);
    const cutoff = new Date(Date.now() - METER_STALL_MS);
    const [latest, old] = await Promise.all([
      col.findOne({}, { sort: { _id: -1 } }),
      col.findOne({ receivedAt: { $lte: cutoff } }, { sort: { receivedAt: -1 } }),
    ]);
    if (!latest || !old) return;
    const mp = (latest as any).payload || {};
    const mpOld = (old as any).payload || {};

    for (let head = 1; head <= numHeads; head++) {
      const cur = Number(mp[`meter${head}`] ?? 0);
      const oldVal = Number(mpOld[`meter${head}`] ?? 0);
      const key = `meter${head}`;

      if (oldVal > 0 && cur === oldVal) {
        await emitAlertOnce({
          stationId, type: 'meter', severity: 'warning', alertKey: key,
          message: `${stationId} Meter ${head} stalled for > 2 days (value unchanged at ${(cur / 1000).toFixed(1)} kWh)`,
        });
      } else {
        clearAlert(stationId, key);
      }
    }
  } catch {}
}

async function checkPmCount(stationId: string, station: any): Promise<void> {
  const collectionName = station.mongoCollections?.powerModule;
  if (!collectionName) return;
  try {
    const col = getDbByName(PM_DB).collection(collectionName);
    const numHeads = Number(station.chargerHeads) || 2;

    for (let head = 1; head <= numHeads; head++) {
      const exp = head === 1
        ? Number(station.expectedPmHead1 ?? station.expectedPmPerHead ?? 3)
        : Number(station.expectedPmHead2 ?? station.expectedPmPerHead ?? 3);

      const doc = await col.findOne(
        { [`payload.PM${head}`]: { $exists: true } },
        { sort: { _id: -1 } },
      );
      if (!doc) continue;

      const pmCount = Number((doc as any).payload?.[`PM${head}`] ?? 0);
      const key = `pm${head}`;

      if (pmCount < exp) {
        const headLabel = numHeads > 1 ? `Head ${head}` : 'Charger';
        await emitAlertOnce({
          stationId, type: 'power', severity: 'warning', alertKey: key,
          message: `${stationId} ${headLabel} PM count ${pmCount}/${exp} — module(s) missing`,
        });
      } else {
        clearAlert(stationId, key);
      }
    }
  } catch {}
}

async function checkScriptOffline(stationId: string): Promise<void> {
  try {
    const scripts = await getStationDb().collection('_script_status')
      .find({ stationId }).toArray();
    const now = Date.now();

    for (const s of scripts) {
      const ls = (s as any).lastSeen;
      const lastSeen = ls instanceof Date ? ls.getTime() : new Date(ls).getTime();
      const isOffline = isNaN(lastSeen) || (now - lastSeen) > SCRIPT_TIMEOUT_MS;
      const key = `script:${s.script}`;

      if (isOffline) {
        await emitAlertOnce({
          stationId, type: 'script', severity: 'warning', alertKey: key,
          message: `${stationId} script "${s.script}" offline — no heartbeat for > 5 min`,
        });
      } else {
        clearAlert(stationId, key);
      }
    }
  } catch {}
}

// ── Public entry: run all checks for all stations ──────────────

export async function checkAllAlerts(): Promise<void> {
  try {
    const stations = await loadStations();
    for (const st of stations) {
      const numHeads = Number(st.chargerHeads) || 2;
      await Promise.all([
        checkTemperature(st.id),
        checkMeterStalled(st.id, st.mongoCollections?.meter, numHeads),
        checkPmCount(st.id, st),
        checkScriptOffline(st.id),
      ]);
    }
  } catch (err: any) {
    console.error('[alerts] check error:', err.message);
  }
}
