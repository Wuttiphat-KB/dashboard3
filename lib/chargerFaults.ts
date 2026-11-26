/**
 * Charger fault status + exception alarm — pure helpers shared by the backend, the index
 * script and the tests (no MQTT and no Mongo connection in here).
 *
 * Source: MQTT_Alarm_Topics.md (charger program CP.py). Broker QoS 0, one JSON per message,
 * timestamps are ISO 8601 with an offset (e.g. 2026-11-26T14:15:42.318+07:00):
 *
 *   OCPP/<OCPPSTATION>/FaultStatus/<connectorId>  retained — latest fault state of one connector
 *                                                  (0 = whole cabinet, only after a Vector cabinet fault)
 *   OCPP/<OCPPSTATION>/FaultStatus                events — fault:true for every Faulted StatusNotification
 *                                                  (several per connector, different vendorErrorCode),
 *                                                  fault:false once when the connector leaves Faulted
 *   OCPP/<OCPPSTATION>/ExceptionAlarm             CSMS connection lost (alarm:true, repeated on every retry)
 *                                                  / connected again (alarm:false). NOT a charger fault.
 *
 * Stored in DB `Station` (fixed collections, names start with "_" so the station-config scan skips them):
 *   _fault_status      1 doc per (stationId, connectorId) — latest state, written from the retained topic
 *   _fault_status_log  1 doc per fault message — history; episodeId groups one Faulted period
 *   _exception_alarms  1 doc per CSMS outage per (stationId, csms)
 *
 * Time fields: `timestamp`, `startedAt`, `lastSeenAt`, `endedAt` come from the charger's clock (for display).
 * `receivedAt`, `updatedAt`, `closedAt` come from this server's clock and are the ones used for TTL and
 * staleness, so a charger with a wrong clock can neither expire its own history nor look "stale".
 */

import type { CreateIndexesOptions, Db } from 'mongodb';

export const COL_FAULT_STATUS = '_fault_status';
export const COL_FAULT_LOG = '_fault_status_log';
export const COL_EXCEPTION_ALARMS = '_exception_alarms';

/** Backend topic keys (the `onMessage` / `registerStation` keys). */
export const FAULT_EVENT_KEY = 'faultEvent';
export const EXCEPTION_ALARM_KEY = 'exceptionAlarm';
export const FAULT_LATEST_KEYS = ['faultLatest0', 'faultLatest1', 'faultLatest2'] as const;

// ── Topics ───────────────────────────────────────────────────────────────

/**
 * <OCPPSTATION> is the middle part of the station's heartbeat topic `OCPP/<OCPPSTATION>/heartbeat`.
 * It is NOT the dashboard station name for most stations (125 of 200 in the import CSV differ),
 * so it has to come from the configured heartbeat topic. Anything else (heartbeatPI5, a topic
 * without the OCPP/ prefix, wildcards) returns null.
 */
export function ocppStationFromHeartbeat(topic: unknown): string | null {
  if (typeof topic !== 'string') return null;
  const m = /^OCPP\/([^/+#]+)\/heartbeat$/.exec(topic.trim());
  return m ? m[1] : null;
}

/** key → topic for one station, ready to merge into the `registerStation` topic map. */
export function chargerFaultTopics(ocppStation: string): Record<string, string> {
  const base = `OCPP/${ocppStation}`;
  return {
    [FAULT_EVENT_KEY]: `${base}/FaultStatus`,
    faultLatest0: `${base}/FaultStatus/0`,
    faultLatest1: `${base}/FaultStatus/1`,
    faultLatest2: `${base}/FaultStatus/2`,
    [EXCEPTION_ALARM_KEY]: `${base}/ExceptionAlarm`,
  };
}

export function connectorFromFaultTopic(topic: string): number | null {
  const m = /\/FaultStatus\/(\d+)$/.exec(topic);
  return m ? Number(m[1]) : null;
}

// ── Payload parsing ──────────────────────────────────────────────────────

function asObject(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function parseTimestamp(v: unknown): Date | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface FaultMessage {
  connectorId: number;
  status: string | null;
  fault: boolean;
  errorCode: string | null;
  info: string | null;
  vendorId: string | null;
  vendorErrorCode: string | null;
  timestamp: Date;
}

/** null = not a usable fault message (text payload, no boolean `fault`, no valid timestamp / connector). */
export function parseFaultMessage(payload: unknown, topicConnectorId?: number | null): FaultMessage | null {
  const p = asObject(payload);
  if (!p || typeof p.fault !== 'boolean') return null;
  const timestamp = parseTimestamp(p.timestamp);
  if (!timestamp) return null;

  let connectorId: number | null = null;
  if (typeof p.connectorId === 'number' && Number.isInteger(p.connectorId) && p.connectorId >= 0) connectorId = p.connectorId;
  else if (typeof topicConnectorId === 'number' && Number.isInteger(topicConnectorId) && topicConnectorId >= 0) connectorId = topicConnectorId;
  if (connectorId === null) return null;

  return {
    connectorId,
    status: str(p.status),
    fault: p.fault,
    errorCode: str(p.errorCode),
    info: str(p.info),
    vendorId: str(p.vendorId),
    vendorErrorCode: str(p.vendorErrorCode),
    timestamp,
  };
}

export interface AlarmMessage {
  message: string;
  error: string | null;
  source: string;
  alarm: boolean;
  /** "A" / "B" in Dual CSMS mode, null in single-CSMS mode. */
  csms: string | null;
  attempt: number | null;
  retryIn: number | null;
  timestamp: Date;
}

export function parseExceptionAlarm(payload: unknown): AlarmMessage | null {
  const p = asObject(payload);
  if (!p || typeof p.alarm !== 'boolean') return null;
  const timestamp = parseTimestamp(p.timestamp);
  if (!timestamp) return null;
  const csms = str(p.csms);
  return {
    message: str(p.message) ?? '',
    error: str(p.error),
    source: str(p.source) ?? 'unknown',
    alarm: p.alarm,
    csms: csms && csms.trim() ? csms.trim() : null,
    attempt: finite(p.attempt),
    retryIn: finite(p.retryIn),
    timestamp,
  };
}

// ── Fault episodes ───────────────────────────────────────────────────────

export type FaultSource = 'event' | 'retained';

export interface FaultDecision {
  /** Timestamp of the first fault:true of the Faulted period this message belongs to (null = none known). */
  episodeId: Date | null;
  /** Whether the message belongs in `_fault_status_log`. */
  write: boolean;
}

/**
 * Tracks the open Faulted period of every (station, connector) so that the history rows of one
 * period share an episodeId (duration = max - min of the group).
 *
 * Both topics describe the same events: the event topic is the history, the retained topic is the
 * latest state. The retained copy only matters when an event was missed (backend down): it then
 * opens or closes the period, so the log never stays "faulted" for ever. When both copies arrive
 * they carry the same timestamp and vendorErrorCode and the unique index drops the duplicate.
 */
export class FaultEpisodeTracker {
  private open = new Map<string, Date>();

  private static key(stationId: string, connectorId: number): string {
    return `${stationId}#${connectorId}`;
  }

  seed(stationId: string, connectorId: number, episodeId: Date): void {
    this.open.set(FaultEpisodeTracker.key(stationId, connectorId), episodeId);
  }

  openEpisode(stationId: string, connectorId: number): Date | undefined {
    return this.open.get(FaultEpisodeTracker.key(stationId, connectorId));
  }

  get size(): number { return this.open.size; }

  onMessage(stationId: string, msg: FaultMessage, source: FaultSource): FaultDecision {
    const key = FaultEpisodeTracker.key(stationId, msg.connectorId);
    const existing = this.open.get(key);

    if (msg.fault) {
      if (existing) return { episodeId: existing, write: true };
      this.open.set(key, msg.timestamp);
      return { episodeId: msg.timestamp, write: true };
    }

    if (existing) {
      this.open.delete(key);
      return { episodeId: existing, write: true };
    }
    // fault:false with no period known: an event is still worth logging ("fault ended", the start was
    // missed); the retained copy is also sent on every CP.py start / reconnect, which is not an event.
    return { episodeId: null, write: source === 'event' };
  }
}

// ── Exception alarm (CSMS connection) outages ────────────────────────────

export type AlarmAction =
  | { type: 'open' }                          // insert a new outage doc
  | { type: 'touch'; messages: number }       // refresh the open doc (messages = messages since the last write)
  | { type: 'close' }                         // alarm:false — close the open doc
  | { type: 'skip' }                          // repeat inside the throttle window (counted, not written)
  | { type: 'ignore' };                       // alarm:false with nothing open (normal after CP.py start)

interface AlarmState { open: boolean; lastWriteAt: number; pending: number }

/**
 * While the CSMS is down the charger repeats alarm:true on every retry (every ~5–15 s), so repeats
 * are collapsed into one doc and written at most once per `throttleMs`.
 */
export class AlarmTracker {
  private states = new Map<string, AlarmState>();

  constructor(private readonly throttleMs = 10_000) {}

  private static key(stationId: string, csms: string | null): string {
    return `${stationId}#${csms ?? ''}`;
  }

  seed(stationId: string, csms: string | null, nowMs = Date.now()): void {
    this.states.set(AlarmTracker.key(stationId, csms), { open: true, lastWriteAt: nowMs, pending: 0 });
  }

  markClosed(stationId: string, csms: string | null): void {
    this.states.delete(AlarmTracker.key(stationId, csms));
  }

  isOpen(stationId: string, csms: string | null): boolean {
    return this.states.get(AlarmTracker.key(stationId, csms))?.open === true;
  }

  onMessage(stationId: string, msg: Pick<AlarmMessage, 'alarm' | 'csms'>, nowMs: number): AlarmAction {
    const key = AlarmTracker.key(stationId, msg.csms);
    const st = this.states.get(key);

    if (!msg.alarm) {
      if (!st?.open) return { type: 'ignore' };
      this.states.delete(key);
      return { type: 'close' };
    }

    if (!st?.open) {
      this.states.set(key, { open: true, lastWriteAt: nowMs, pending: 0 });
      return { type: 'open' };
    }
    st.pending += 1;
    if (nowMs - st.lastWriteAt < this.throttleMs) return { type: 'skip' };
    const messages = st.pending;
    st.pending = 0;
    st.lastWriteAt = nowMs;
    return { type: 'touch', messages };
  }
}

/**
 * An outage doc that has not been refreshed for a while is closed as "timeout": the spec says that
 * no message means the CSMS connection is fine, and ExceptionAlarm is not retained, so an alarm:false
 * sent while the backend was down is never seen. Based on the server clock (`updatedAt`).
 */
export function isAlarmStale(
  doc: { updatedAt: Date; retryIn?: number | null },
  nowMs: number,
  minStaleMs = 120_000,
): boolean {
  const wait = Math.max(minStaleMs, (doc.retryIn ?? 0) * 3_000);
  return nowMs - doc.updatedAt.getTime() > wait;
}

export function durationSec(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
}

// ── Serialising writes per key ───────────────────────────────────────────

/** Runs async jobs one at a time per key, in submission order (e.g. true → false of one connector). */
export class KeyedQueue {
  private tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, job: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const result = prev.then(job);
    const tail = result.then(() => undefined, () => undefined);
    this.tails.set(key, tail);
    void tail.then(() => { if (this.tails.get(key) === tail) this.tails.delete(key); });
    return result;
  }
}

// ── Indexes ──────────────────────────────────────────────────────────────

export interface ChargerIndexSpec {
  collection: string;
  keys: Record<string, 1 | -1>;
  options: CreateIndexesOptions & { name: string };
}

type Env = Record<string, string | undefined>;

function retentionSeconds(name: string, env: Env): number {
  return Math.max(1, Number(env[name]) || 365) * 86_400;
}

export function chargerFaultIndexes(env: Env = process.env): ChargerIndexSpec[] {
  const faultTtl = retentionSeconds('FAULT_LOG_RETENTION_DAYS', env);
  const alarmTtl = retentionSeconds('EXCEPTION_ALARM_RETENTION_DAYS', env);
  return [
    { collection: COL_FAULT_STATUS, keys: { stationId: 1, connectorId: 1 }, options: { unique: true, name: 'station_connector' } },
    { collection: COL_FAULT_STATUS, keys: { fault: 1 }, options: { name: 'fault' } },

    { collection: COL_FAULT_LOG, keys: { stationId: 1, connectorId: 1, timestamp: -1 }, options: { name: 'station_connector_time' } },
    { collection: COL_FAULT_LOG, keys: { vendorErrorCode: 1, timestamp: -1 }, options: { name: 'vendor_code_time' } },
    { collection: COL_FAULT_LOG, keys: { timestamp: -1 }, options: { name: 'time' } },
    // The event topic and the retained topic carry the same message — keep it once.
    { collection: COL_FAULT_LOG, keys: { stationId: 1, connectorId: 1, vendorErrorCode: 1, fault: 1, timestamp: 1 }, options: { unique: true, name: 'dedupe_message' } },
    { collection: COL_FAULT_LOG, keys: { receivedAt: 1 }, options: { expireAfterSeconds: faultTtl, name: 'ttl_received' } },

    // At most one open outage per station and CSMS.
    { collection: COL_EXCEPTION_ALARMS, keys: { stationId: 1, csms: 1 }, options: { unique: true, partialFilterExpression: { active: true }, name: 'one_open_per_csms' } },
    { collection: COL_EXCEPTION_ALARMS, keys: { stationId: 1, startedAt: -1 }, options: { name: 'station_time' } },
    { collection: COL_EXCEPTION_ALARMS, keys: { startedAt: -1 }, options: { name: 'time' } },
    // closedAt is null while open, so open outages never expire.
    { collection: COL_EXCEPTION_ALARMS, keys: { closedAt: 1 }, options: { expireAfterSeconds: alarmTtl, name: 'ttl_closed' } },
  ];
}

/** Idempotent. Returns the specs that could not be created (e.g. a TTL changed after the index existed). */
export async function createChargerFaultIndexes(
  db: Db,
  only?: readonly string[],
  env: Env = process.env,
): Promise<{ ok: number; failed: string[] }> {
  let ok = 0;
  const failed: string[] = [];
  for (const spec of chargerFaultIndexes(env)) {
    if (only && !only.includes(spec.collection)) continue;
    try {
      await db.collection(spec.collection).createIndex(spec.keys, spec.options);
      ok++;
    } catch (err: any) {
      failed.push(`${spec.collection}.${spec.options.name}: ${err?.message || err}`);
    }
  }
  return { ok, failed };
}
