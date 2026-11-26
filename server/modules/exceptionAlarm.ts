/**
 * Exception alarm (charger ↔ CSMS connection) — MQTT → MongoDB (DB "Station", collection _exception_alarms).
 *
 *   OCPP/<OCPPSTATION>/ExceptionAlarm   alarm:true  = CSMS connection lost (repeated on every retry)
 *                                       alarm:false = connected again
 *
 * One doc per outage per (stationId, csms): opened by the first alarm:true, refreshed (throttled) by the
 * repeats, closed by alarm:false. The topic is not retained, so an outage whose alarm:false was missed is
 * closed as "timeout" by sweepExceptionAlarms(). See lib/chargerFaults.ts.
 */

import { getStationDb } from '../mongo';
import { onMessage } from '../mqtt';
import {
  AlarmTracker,
  COL_EXCEPTION_ALARMS,
  EXCEPTION_ALARM_KEY,
  KeyedQueue,
  createChargerFaultIndexes,
  durationSec,
  isAlarmStale,
  parseExceptionAlarm,
  type AlarmAction,
  type AlarmMessage,
} from '../../lib/chargerFaults';

const tracker = new AlarmTracker(10_000);
const queue = new KeyedQueue();
let ready: Promise<void> = Promise.resolve();

const STALE_MIN_MS = Math.max(30, Number(process.env.EXCEPTION_ALARM_STALE_SEC) || 120) * 1000;

const lastWarn = new Map<string, number>();
function warnRateLimited(key: string, text: string): void {
  const now = Date.now();
  if (now - (lastWarn.get(key) ?? 0) < 10 * 60_000) return;
  lastWarn.set(key, now);
  console.warn(text);
}

async function seed(): Promise<void> {
  const db = getStationDb();
  const idx = await createChargerFaultIndexes(db, [COL_EXCEPTION_ALARMS]);
  if (idx.failed.length) console.error(`[exception] index creation failed: ${idx.failed.join('; ')}`);

  const open = await db.collection(COL_EXCEPTION_ALARMS).find({ active: true }, { maxTimeMS: 20_000 }).toArray();
  for (const d of open) {
    if (typeof d.stationId === 'string') tracker.seed(d.stationId, typeof d.csms === 'string' ? d.csms : null);
  }
  console.log(`[exception] restored ${open.length} open outage(s) from ${COL_EXCEPTION_ALARMS}`);
}

async function apply(stationId: string, msg: AlarmMessage, action: AlarmAction): Promise<void> {
  const col = getStationDb().collection(COL_EXCEPTION_ALARMS);
  const csms = msg.csms;
  const now = new Date();
  const openFilter = { stationId, csms, active: true };
  const latest = {
    lastSeenAt: msg.timestamp,
    updatedAt: now,
    source: msg.source,
    message: msg.message,
    error: msg.error,
    attempt: msg.attempt,
    retryIn: msg.retryIn,
  };

  if (action.type === 'open' || action.type === 'touch') {
    if (action.type === 'touch') {
      const r = await col.updateOne(openFilter, { $set: latest, $inc: { messageCount: action.messages } });
      if (r.matchedCount > 0) return;
      // Nothing open in the DB (closed by the sweep, or never written): start a new outage below.
    }
    try {
      await col.insertOne({
        stationId,
        csms,
        active: true,
        startedAt: msg.timestamp,
        endedAt: null,
        durationSec: null,
        closedAt: null,
        endReason: null,
        messageCount: 1,
        receivedAt: now,
        ...latest,
      });
      console.log(`[exception] ${stationId}${csms ? ` (${csms})` : ''} CSMS connection lost: ${msg.error ?? msg.message}`);
    } catch (err: any) {
      if (err?.code !== 11000) throw err;
      // An outage is already open (tracker was not aware of it): this message is just a repeat.
      await col.updateOne(openFilter, { $set: latest, $inc: { messageCount: 1 } });
    }
    return;
  }

  if (action.type === 'close') {
    const doc = await col.findOne(openFilter);
    if (!doc) return;
    const started = doc.startedAt instanceof Date ? doc.startedAt : msg.timestamp;
    await col.updateOne(
      { _id: doc._id, active: true },
      {
        $set: {
          active: false,
          endedAt: msg.timestamp,
          durationSec: durationSec(started, msg.timestamp),
          closedAt: now,
          endReason: 'connected',
          closeMessage: msg.message,
          updatedAt: now,
        },
      },
    );
    console.log(`[exception] ${stationId}${csms ? ` (${csms})` : ''} CSMS connected again`);
  }
}

async function handle(stationId: string, topic: string, payload: unknown): Promise<void> {
  await ready;

  const msg = parseExceptionAlarm(payload);
  if (!msg) {
    warnRateLimited(`${stationId}|${topic}`, `[exception] ignored an unusable message on ${topic} (${stationId})`);
    return;
  }

  const action = tracker.onMessage(stationId, msg, Date.now());
  if (action.type === 'skip' || action.type === 'ignore') return;
  await queue.run(`${stationId}#${msg.csms ?? ''}`, () => apply(stationId, msg, action));
}

export function initExceptionAlarmHandler(): void {
  ready = seed().catch(err => console.error('[exception] seed failed:', err?.message || err));

  onMessage(EXCEPTION_ALARM_KEY, (stationId, topic, payload) => {
    handle(stationId, topic, payload).catch(err =>
      console.error(`[exception] write failed (${stationId}):`, err?.message || err),
    );
  });
}

let sweeping = false;

/**
 * Close outages that have not been refreshed for a while (alarm:false lost, station offline, backend was
 * down). Call on an interval. Closed with endReason "timeout" and endedAt = the last message seen.
 */
export async function sweepExceptionAlarms(): Promise<void> {
  if (sweeping) return;
  sweeping = true;
  try {
    await ready;
    const col = getStationDb().collection(COL_EXCEPTION_ALARMS);
    const open = await col.find({ active: true }, { maxTimeMS: 10_000 }).toArray();
    const isStale = (d: Record<string, unknown>) =>
      d.updatedAt instanceof Date &&
      isAlarmStale({ updatedAt: d.updatedAt, retryIn: typeof d.retryIn === 'number' ? d.retryIn : null }, Date.now(), STALE_MIN_MS);

    for (const d of open) {
      if (!isStale(d) || typeof d.stationId !== 'string') continue;
      const stationId = d.stationId;
      const csms = typeof d.csms === 'string' ? d.csms : null;
      await queue.run(`${stationId}#${csms ?? ''}`, async () => {
        // Re-read inside the queue: a message may have refreshed the outage in the meantime.
        const fresh = await col.findOne({ _id: d._id, active: true });
        if (!fresh || !isStale(fresh)) return;
        const lastSeen = fresh.lastSeenAt instanceof Date ? fresh.lastSeenAt : fresh.startedAt;
        const now = new Date();
        await col.updateOne(
          { _id: fresh._id, active: true },
          {
            $set: {
              active: false,
              endedAt: lastSeen,
              durationSec: fresh.startedAt instanceof Date ? durationSec(fresh.startedAt, lastSeen) : null,
              closedAt: now,
              endReason: 'timeout',
              updatedAt: now,
            },
          },
        );
        tracker.markClosed(stationId, csms);
        console.log(`[exception] ${stationId}${csms ? ` (${csms})` : ''} outage closed (no message for a while)`);
      });
    }
  } catch (err: any) {
    console.error('[exception] sweep failed:', err?.message || err);
  } finally {
    sweeping = false;
  }
}
