/**
 * Vector controller — consumes a single `vectorState` MQTT topic and maps the
 * Vector payload into the same Phoenix-shaped caches (`_plc_data`, `_pm_data`,
 * `_meter_latest`) that the rest of the system already reads.
 *
 * Vector payload shape (excerpt):
 *   {
 *     charger: "...", ts: "...",
 *     connectors: { "1": {...}, "2": {...} },
 *     power_module: { status, modules: { per_group: { "1": {...}, "2": {...} } } },
 *     isolation: { iso1, iso2, imd_status },
 *     temps: { t1, t2, t3, t4 },
 *     contactor: { c1, c2 },
 *     emergency, estop_active
 *   }
 *
 * The handler ALSO writes per-station history into PowerModule.{station} and
 * (optionally) StatePLC.{station} so the chargeAggregator's seed function and
 * /api/fleet's on-demand fallback work the same for Vector and Phoenix.
 */

import { onMessage } from '../mqtt';
import { getStationDb, getDbByName } from '../mongo';

const PM_DB       = 'PowerModule';
const STATEPLC_DB = 'StatePLC';

// stationId → StatePLC collection name (set by registerVectorStation via server/index.ts)
const statePlcCollections = new Map<string, string>();
// stationId → PowerModule collection name
const pmCollections       = new Map<string, string>();

/** Called from server/index.ts registerStationConfig() for Vector stations. */
export function registerVectorStation(
  stationId: string,
  collections: { powerModule?: string; statePlc?: string },
): void {
  if (collections.powerModule) pmCollections.set(stationId, collections.powerModule);
  else pmCollections.delete(stationId);

  if (collections.statePlc) statePlcCollections.set(stationId, collections.statePlc);
  else statePlcCollections.delete(stationId);
}

export function unregisterVectorStation(stationId: string): void {
  pmCollections.delete(stationId);
  statePlcCollections.delete(stationId);
}

// ── Helpers ─────────────────────────────────────────────────────────────

function mapChargeState(cp: string | null | undefined): string {
  if (!cp) return 'Unknown';
  if (cp === 'state_a') return 'Ready';
  if (cp === 'state_b') return 'Connected';
  if (cp === 'state_c' || cp === 'state_d') return 'Charging';
  if (cp === 'state_e' || cp === 'state_f') return 'Fault';
  return 'Unknown';
}

function num(v: any): number {
  if (v == null) return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

/** Strip Vector's "no error" sentinel so the dashboard shows an empty string. */
function cleanErrCode(code: any): string {
  if (!code) return '';
  const s = String(code);
  if (s === 'VSECCLIB_DC_EVERROR_CODE_TYPE_NO_ERROR') return '';
  return s;
}

/**
 * Phoenix-format timestamp: ISO 8601 in LOCAL time, no `Z` suffix
 * (e.g. "2026-05-29T10:30:45.123").
 *
 * Vector firmware's `ts` field is unreliable — some boxes have unsynced clocks
 * that emit dates years off. We ignore it and stamp every payload with the
 * backend's clock so timeSince() / fmtTs() on the frontend stay sensible and
 * match the format Phoenix produces.
 */
function nowPhoenixIso(): string {
  const d = new Date();
  const tzOffsetMs = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tzOffsetMs).toISOString().slice(0, -1);
}

// ── PLC cache ──────────────────────────────────────────────────────────

async function syncPlcDataFromVector(stationId: string, vp: any): Promise<void> {
  const c1 = vp?.connectors?.['1'] || {};
  const c2 = vp?.connectors?.['2'] || {};
  const pm = vp?.power_module || {};
  const grp = pm?.modules?.per_group || {};
  const grp1 = grp['1'] || {};
  const grp2 = grp['2'] || {};
  const iso = vp?.isolation || {};
  const temps = vp?.temps || {};
  const ts = nowPhoenixIso();

  // PLC{N}_status: use power_module.status as a proxy (Vector doesn't expose
  // PLC1/PLC2 health separately). Active when status == "operative".
  const pmActive  = pm?.status === 'operative' ? 'Active' : 'Inactive';
  const imdActive = iso?.imd_status === 'operative' ? 'Active' : 'Inactive';
  // Emergency loop reports 1 = OK / 0 = tripped. Combined with explicit estop.
  const emergencyActive = vp?.estop_active === true || Number(vp?.emergency) === 0;
  // temps.faulty is either null or an array of failed sensor names like ["t1","t3"]
  const tempSensorFaults: string[] = Array.isArray(temps?.faulty) ? temps.faulty.map((s: any) => String(s)) : [];

  // The shape mimics what the Phoenix PLC payload looks like so all the
  // existing readers (Dashboard PLC tab, /api/fleet, DeviceStatusCard) work
  // without any frontend changes.
  const payload: any = {
    chargeState1: mapChargeState(c1.cp_state),
    chargeState2: mapChargeState(c2.cp_state),
    SOC1:         num(c1.soc),
    SOC2:         num(c2.soc),
    powerKw1:     num(c1.power_kw),
    powerKw2:     num(c2.power_kw),
    presentVoltage1: num(c1.meas_v),
    presentVoltage2: num(c2.meas_v),
    presentCurrent1: num(c1.meas_i),
    presentCurrent2: num(c2.meas_i),

    // Cable terminal temps — Vector marks broken sensors via `temps.faulty`.
    // When a sensor is in that list the raw value is null; num(null)→0 so the
    // frontend renders "—". We don't bury the fault: the list is also exposed
    // separately in tempSensorFaults below.
    temp1Head1: num(temps.t1),
    temp2Head1: num(temps.t2),
    temp1Head2: num(temps.t3),
    temp2Head2: num(temps.t4),
    // Vector doesn't measure PowerModule internal temp — t1-t4 are cable temps.
    // Leave 0 so the UI displays "—" instead of repeating cable temp.
    tempPowerModule1: 0,
    tempPowerModule2: 0,

    insulationFault1: num(iso.iso1) === 1 ? 0 : 1,
    insulationFault2: num(iso.iso2) === 1 ? 0 : 1,

    head1Error:   (cleanErrCode(c1.err_code) || (c1.active_failures?.length ?? 0) > 0) ? 1 : 0,
    head2Error:   (cleanErrCode(c2.err_code) || (c2.active_failures?.length ?? 0) > 0) ? 1 : 0,
    errorMessage1: cleanErrCode(c1.err_code),
    errorMessage2: cleanErrCode(c2.err_code),

    activeMld1: num(grp1.active),
    activeMld2: num(grp2.active),

    // Device-status row (Device Status overview card reads these). Vector
    // doesn't separate PLC1/PLC2 — proxy from power_module.status.
    HMI_status:  'N/A',  // Vector has no HMI status — user should set hmiBrand:DWIN
    PLC1_status: pmActive,
    PLC2_status: pmActive,
    IMD_status:  imdActive,     // Vector-only — DeviceStatusCard renders this when present

    // Safety extensions — Vector-only fields, ignored by the Phoenix UI path.
    emergencyActive,            // true → station should be flagged DANGER on Device Status
    tempSensorFaults,           // array of broken sensor names ("t1","t3" …) or []

    timestamp: ts,
  };

  try {
    const db = getStationDb();
    await db.collection('_plc_data').updateOne(
      { stationId },
      { $set: { stationId, payload, updatedAt: new Date() } },
      { upsert: true },
    );
  } catch {
    // non-fatal
  }
}

// ── PM cache ───────────────────────────────────────────────────────────

// Throttle per (station, head). Same pattern as cachePmLatest() in powerModule.ts.
const lastPmCacheAt = new Map<string, number>();  // key = `${stationId}#${head}`
const PM_CACHE_THROTTLE_MS = 5_000;

async function syncPmDataFromVector(stationId: string, vp: any): Promise<void> {
  const grp = vp?.power_module?.modules?.per_group || {};
  const now = Date.now();
  const set: any = { stationId, updatedAt: new Date() };
  let wroteAny = false;

  for (const head of [1, 2] as const) {
    const g = grp[String(head)];
    if (!g) continue;
    const key = `${stationId}#${head}`;
    if ((now - (lastPmCacheAt.get(key) ?? 0)) < PM_CACHE_THROTTLE_MS) continue;
    lastPmCacheAt.set(key, now);

    const voltage = num(g.voltage);
    const current = num(g.current);
    set[`head${head}`] = {
      pmCount:     num(g.online),
      voltage,
      current,
      powerKw:     (voltage * current) / 1000,
      prevVoltage: voltage,
      prevCurrent: current,
      timestamp:   nowPhoenixIso(),
    };
    wroteAny = true;
  }

  if (!wroteAny) return;

  try {
    const db = getStationDb();
    await db.collection('_pm_data').updateOne(
      { stationId },
      { $set: set },
      { upsert: true },
    );
  } catch {
    // non-fatal
  }
}

// ── Meter cache (Vector currently always sends null, but plumb it through) ──

const lastMeterCacheAt = new Map<string, number>();
const METER_CACHE_THROTTLE_MS = 5_000;

async function syncMeterFromVector(stationId: string, vp: any): Promise<void> {
  const c1 = vp?.connectors?.['1'] || {};
  const c2 = vp?.connectors?.['2'] || {};
  // If both energy fields are null/missing, skip — leave meter topic in charge.
  if (c1.energy == null && c2.energy == null) return;

  const now = Date.now();
  if ((now - (lastMeterCacheAt.get(stationId) ?? 0)) < METER_CACHE_THROTTLE_MS) return;
  lastMeterCacheAt.set(stationId, now);

  try {
    const db = getStationDb();
    const col = db.collection('_meter_latest');
    const existing: any = await col.findOne({ stationId });
    const newMeter1 = c1.energy != null ? num(c1.energy) : Number(existing?.meter1 ?? 0);
    const newMeter2 = c2.energy != null ? num(c2.energy) : Number(existing?.meter2 ?? 0);
    const nowDate = new Date();

    const isoNow = nowPhoenixIso();
    const set: any = {
      stationId,
      meter1:     newMeter1,
      meter2:     newMeter2,
      timestamp1: isoNow,
      timestamp2: isoNow,
      timestamp:  isoNow,
      updatedAt:  nowDate,
    };
    if (!existing) {
      set.meter1ChangedAt = nowDate;
      set.meter2ChangedAt = nowDate;
    } else {
      if (Number(existing.meter1 ?? 0) !== newMeter1) set.meter1ChangedAt = nowDate;
      if (Number(existing.meter2 ?? 0) !== newMeter2) set.meter2ChangedAt = nowDate;
    }
    await col.updateOne({ stationId }, { $set: set }, { upsert: true });
  } catch {
    // non-fatal
  }
}

// ── Per-station data forwards (history) ───────────────────────────────────

// PowerModule.{station} insert — Phoenix-shape doc so chargeAggregator's
// seedPmAndMeterCaches() picks it up after a restart.
const pmPending = new Map<string, number>();
const PM_PENDING_LIMIT = 50;
let pmDropCount = 0;

async function forwardPmToCollection(stationId: string, vp: any): Promise<void> {
  const collectionName = pmCollections.get(stationId);
  if (!collectionName) return;
  const pending = pmPending.get(stationId) || 0;
  if (pending >= PM_PENDING_LIMIT) {
    pmDropCount++;
    if (pmDropCount % 100 === 1) {
      console.warn(`[vector-pm] backpressure: dropping write for ${stationId} (${pending} pending, ${pmDropCount} total drops)`);
    }
    return;
  }
  pmPending.set(stationId, pending + 1);

  try {
    const grp = vp?.power_module?.modules?.per_group || {};
    const g1 = grp['1'] || {};
    const g2 = grp['2'] || {};
    const v1 = num(g1.voltage), i1 = num(g1.current);
    const v2 = num(g2.voltage), i2 = num(g2.current);

    // Phoenix-shape payload — chargeAggregator looks for `payload.PM1` /
    // `payload.PM2`. We include both in one doc.
    const isoNow = nowPhoenixIso();
    const payload: any = {
      PM1: String(num(g1.online)),
      PM2: String(num(g2.online)),
      Voltage1: v1,
      Voltage2: v2,
      Current1: i1,
      Current2: i2,
      Power1: v1 * i1,        // Phoenix's PowerN is in W, divided by 1000 downstream
      Power2: v2 * i2,
      timestamp1: isoNow,
      timestamp2: isoNow,
      timestamp:  isoNow,
    };

    const db = getDbByName(PM_DB);
    await db.collection(collectionName).insertOne({
      topic: 'vectorState',
      payload,
      qos: 0,
      retain: false,
      receivedAt: new Date(),
    });
  } catch (err: any) {
    console.error(`[vector-pm] forward error (${stationId}):`, err.message);
  } finally {
    pmPending.set(stationId, (pmPending.get(stationId) || 1) - 1);
  }
}

// StatePLC.{station} insert — change-filtered like Phoenix's forwardPlcToStatePlc().
const lastForwardedStatePlc = new Map<string, Record<string, unknown>>();

async function forwardStatePlc(stationId: string, vp: any, plcPayload: any): Promise<void> {
  const collectionName = statePlcCollections.get(stationId);
  if (!collectionName) return;

  const last = lastForwardedStatePlc.get(stationId) || {};
  let hasChange = false;
  for (const key in plcPayload) {
    if (key === 'timestamp') continue;
    if ((last as any)[key] !== plcPayload[key]) { hasChange = true; break; }
  }
  if (!hasChange) return;

  const snapshot: Record<string, unknown> = {};
  for (const key in plcPayload) {
    if (key !== 'timestamp') snapshot[key] = plcPayload[key];
  }
  lastForwardedStatePlc.set(stationId, snapshot);

  try {
    const db = getDbByName(STATEPLC_DB);
    await db.collection(collectionName).insertOne({
      ...plcPayload,
      stationId,
      receivedAt: new Date(),
      // Keep a copy of the raw Vector envelope for debugging.
      _vectorRaw: vp,
    });
  } catch (err: any) {
    console.error(`[vector-stateplc] forward error (${stationId}):`, err.message);
  }
}

// ── Entry point ───────────────────────────────────────────────────────

export function initVectorHandler(): void {
  onMessage('vectorState', (stationId, _topic, payload) => {
    if (!payload || typeof payload !== 'object') return;
    const vp: any = payload;

    // Build the Phoenix-shape PLC payload once so forwardStatePlc can reuse it.
    const c1 = vp?.connectors?.['1'] || {};
    const c2 = vp?.connectors?.['2'] || {};
    const pm = vp?.power_module || {};
    const grp = pm?.modules?.per_group || {};
    const grp1 = grp['1'] || {};
    const grp2 = grp['2'] || {};
    const iso = vp?.isolation || {};
    const temps = vp?.temps || {};
    const pmActive  = pm?.status === 'operative' ? 'Active' : 'Inactive';
    const imdActive = iso?.imd_status === 'operative' ? 'Active' : 'Inactive';
    const emergencyActive = vp?.estop_active === true || Number(vp?.emergency) === 0;
    const tempSensorFaults: string[] = Array.isArray(temps?.faulty) ? temps.faulty.map((s: any) => String(s)) : [];

    const plcPayloadForStatePlc: any = {
      chargeState1: mapChargeState(c1.cp_state),
      chargeState2: mapChargeState(c2.cp_state),
      SOC1: num(c1.soc), SOC2: num(c2.soc),
      powerKw1: num(c1.power_kw), powerKw2: num(c2.power_kw),
      presentVoltage1: num(c1.meas_v), presentVoltage2: num(c2.meas_v),
      presentCurrent1: num(c1.meas_i), presentCurrent2: num(c2.meas_i),
      temp1Head1: num(temps.t1), temp2Head1: num(temps.t2),
      temp1Head2: num(temps.t3), temp2Head2: num(temps.t4),
      insulationFault1: num(iso.iso1) === 1 ? 0 : 1,
      insulationFault2: num(iso.iso2) === 1 ? 0 : 1,
      activeMld1: num(grp1.active), activeMld2: num(grp2.active),
      errorMessage1: cleanErrCode(c1.err_code),
      errorMessage2: cleanErrCode(c2.err_code),
      HMI_status:  'N/A',
      PLC1_status: pmActive,
      PLC2_status: pmActive,
      IMD_status:  imdActive,
      emergencyActive,
      tempSensorFaults,
      timestamp: nowPhoenixIso(),
    };

    // Caches in Station DB — read by /api/fleet + /api/dashboard.
    syncPlcDataFromVector(stationId, vp);
    syncPmDataFromVector(stationId, vp);
    syncMeterFromVector(stationId, vp);

    // History in per-station DBs — Phoenix shape, for restart safety / aggregator seed.
    forwardPmToCollection(stationId, vp);
    forwardStatePlc(stationId, vp, plcPayloadForStatePlc);
  });
}
