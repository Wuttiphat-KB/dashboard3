/**
 * Charger fault status — MQTT → MongoDB (DB "Station").
 *
 *   OCPP/<OCPPSTATION>/FaultStatus/<connectorId>  (retained)  → _fault_status      latest state, 1 doc per connector
 *   OCPP/<OCPPSTATION>/FaultStatus                (events)    → _fault_status_log  history, 1 doc per message
 *
 * The retained copy of an event also repairs the log when the backend missed the event (it was down):
 * it opens a Faulted period that the log does not know about, or closes one that is still open.
 * See lib/chargerFaults.ts for the rules and the topic format.
 */

import { getStationDb } from '../mongo';
import { onMessage } from '../mqtt';
import {
  COL_FAULT_LOG,
  COL_FAULT_STATUS,
  FAULT_EVENT_KEY,
  FAULT_LATEST_KEYS,
  FaultEpisodeTracker,
  KeyedQueue,
  connectorFromFaultTopic,
  createChargerFaultIndexes,
  parseFaultMessage,
  type FaultDecision,
  type FaultMessage,
  type FaultSource,
} from '../../lib/chargerFaults';

const tracker = new FaultEpisodeTracker();
const queue = new KeyedQueue();
/** Index creation + restoring the open Faulted periods; handlers wait for it so no message is judged against an empty tracker. */
let ready: Promise<void> = Promise.resolve();

const lastWarn = new Map<string, number>();
const WARN_EVERY_MS = 10 * 60_000;

function warnRateLimited(key: string, text: string): void {
  const now = Date.now();
  if (now - (lastWarn.get(key) ?? 0) < WARN_EVERY_MS) return;
  lastWarn.set(key, now);
  console.warn(text);
}

async function seed(): Promise<void> {
  const db = getStationDb();
  const idx = await createChargerFaultIndexes(db, [COL_FAULT_STATUS, COL_FAULT_LOG]);
  if (idx.failed.length) console.error(`[fault] index creation failed: ${idx.failed.join('; ')}`);

  const open = await db.collection(COL_FAULT_STATUS).find({ fault: true }, { maxTimeMS: 20_000 }).toArray();
  let restored = 0;
  for (const d of open) {
    const since = d.faultSince instanceof Date ? d.faultSince : d.timestamp instanceof Date ? d.timestamp : null;
    if (since && typeof d.stationId === 'string' && typeof d.connectorId === 'number') {
      tracker.seed(d.stationId, d.connectorId, since);
      restored++;
    }
  }
  console.log(`[fault] restored ${restored} open fault period(s) from ${COL_FAULT_STATUS}`);
}

async function persist(
  stationId: string,
  msg: FaultMessage,
  source: FaultSource,
  decision: FaultDecision,
): Promise<void> {
  const db = getStationDb();
  const receivedAt = new Date();
  const fields = {
    fault: msg.fault,
    status: msg.status,
    errorCode: msg.errorCode,
    info: msg.info,
    vendorId: msg.vendorId,
    vendorErrorCode: msg.vendorErrorCode,
    timestamp: msg.timestamp,
  };

  if (source === 'retained') {
    // Single source for the latest state, so arrival order is the true order (writes of one connector are queued).
    await db.collection(COL_FAULT_STATUS).updateOne(
      { stationId, connectorId: msg.connectorId },
      {
        $set: {
          stationId,
          connectorId: msg.connectorId,
          ...fields,
          faultSince: msg.fault ? decision.episodeId : null,
          updatedAt: receivedAt,
        },
      },
      { upsert: true },
    );
  }

  if (decision.write) {
    try {
      await db.collection(COL_FAULT_LOG).insertOne({
        stationId,
        connectorId: msg.connectorId,
        ...fields,
        episodeId: decision.episodeId,
        source,
        receivedAt,
      });
    } catch (err: any) {
      // 11000 = the same message is already logged (event copy + retained copy).
      if (err?.code !== 11000) throw err;
    }
  }
}

async function handle(stationId: string, topic: string, payload: unknown, source: FaultSource): Promise<void> {
  await ready;

  const msg = parseFaultMessage(payload, source === 'retained' ? connectorFromFaultTopic(topic) : null);
  if (!msg) {
    warnRateLimited(`${stationId}|${topic}`, `[fault] ignored an unusable message on ${topic} (${stationId})`);
    return;
  }

  // Decided right here, in arrival order; the (slower) write is queued per connector.
  const decision = tracker.onMessage(stationId, msg, source);
  if (source === 'event') {
    console.log(`[fault] ${stationId} connector ${msg.connectorId} ${msg.fault ? 'FAULT' : 'cleared'} ${msg.vendorErrorCode ?? msg.errorCode ?? ''}`.trimEnd());
  }
  await queue.run(`${stationId}#${msg.connectorId}`, () => persist(stationId, msg, source, decision));
}

function run(stationId: string, topic: string, payload: unknown, source: FaultSource): void {
  handle(stationId, topic, payload, source).catch(err =>
    console.error(`[fault] write failed (${stationId}, ${topic}):`, err?.message || err),
  );
}

/** Register the MQTT handlers. Topics are registered per station in server/index.ts (registerStationConfig). */
export function initFaultStatusHandlers(): void {
  ready = seed().catch(err => console.error('[fault] seed failed:', err?.message || err));

  onMessage(FAULT_EVENT_KEY, (stationId, topic, payload) => run(stationId, topic, payload, 'event'));
  for (const key of FAULT_LATEST_KEYS) {
    onMessage(key, (stationId, topic, payload) => run(stationId, topic, payload, 'retained'));
  }
}
