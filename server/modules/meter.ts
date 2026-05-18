/**
 * Meter — forward MQTT data to MongoDB (database "meter")
 * + broadcast via WebSocket for real-time updates.
 */

import { getState } from '../state';
import { broadcast } from '../ws';
import { onMessage } from '../mqtt';
import { getDbByName, getStationDb } from '../mongo';

const METER_DB = 'meter';

/** stationId → collection name (from station config) */
const meterCollections = new Map<string, string>();

/**
 * Cache latest meter snapshot per station in `_meter_latest` (Station DB) so the
 * /api/fleet handler can read all 200 station meters from one collection
 * instead of doing 200 findOne()s against the per-station meter collections.
 *
 * Throttled to 1 write per station per 5s — meter messages can arrive faster
 * than that and we don't need sub-second freshness for the dashboard.
 */
const lastMeterCacheAt = new Map<string, number>();
const METER_CACHE_THROTTLE_MS = 5_000;

async function cacheMeterLatest(stationId: string, payload: any): Promise<void> {
  const now = Date.now();
  if ((now - (lastMeterCacheAt.get(stationId) ?? 0)) < METER_CACHE_THROTTLE_MS) return;
  lastMeterCacheAt.set(stationId, now);
  try {
    const db = getStationDb();
    const col = db.collection('_meter_latest');

    // Compare incoming values with the previously-cached snapshot so we can
    // track WHEN each meter last changed. The frontend's "Stalled" indicator
    // uses these timestamps — keeping them in MongoDB means backend restarts
    // don't reset the staleness detection.
    const existing: any = await col.findOne({ stationId });
    const newMeter1 = Number(payload?.meter1 ?? 0);
    const newMeter2 = Number(payload?.meter2 ?? 0);
    const nowDate = new Date();

    const set: any = {
      stationId,
      meter1:     newMeter1,
      meter2:     newMeter2,
      timestamp1: payload?.timestamp1 || '',
      timestamp2: payload?.timestamp2 || '',
      timestamp:  payload?.timestamp || '',
      updatedAt:  nowDate,
    };

    // Only bump the "lastChangedAt" timestamps when the value actually changed.
    // First-ever write: seed both timestamps to now.
    if (!existing) {
      set.meter1ChangedAt = nowDate;
      set.meter2ChangedAt = nowDate;
    } else {
      if (Number(existing.meter1 ?? 0) !== newMeter1) set.meter1ChangedAt = nowDate;
      if (Number(existing.meter2 ?? 0) !== newMeter2) set.meter2ChangedAt = nowDate;
      // Otherwise leave existing.meter{N}ChangedAt alone (not in $set).
    }

    await col.updateOne({ stationId }, { $set: set }, { upsert: true });
  } catch {
    // non-fatal
  }
}

/**
 * One-shot migration: for any station in `_meter_latest` that's missing the
 * `meter{N}ChangedAt` fields, look up the oldest meter doc in the per-station
 * meter collection that has the same value as the cached one. That doc's
 * timestamp is our best estimate of when the meter last changed — without
 * it, the frontend's "Stalled" indicator would have to wait 2 days after the
 * first backend boot before it could correctly flag a frozen meter.
 *
 * Safe to run on every startup — only touches docs missing the field, so
 * subsequent runs are no-ops.
 */
const MIGRATION_CONCURRENCY = 10;
export async function backfillMeterChangedAt(stations: { id: string; name: string; mongoCollections?: { meter?: string } }[]): Promise<void> {
  try {
    const stDb = getStationDb();
    const meterDb = getDbByName(METER_DB);

    const candidates = await stDb.collection('_meter_latest').find({
      $or: [
        { meter1ChangedAt: { $exists: false } },
        { meter2ChangedAt: { $exists: false } },
      ],
    }).toArray();
    if (candidates.length === 0) return;

    console.log(`[meter] backfilling meterChangedAt for ${candidates.length} stations...`);
    const tStart = Date.now();
    let done = 0;

    for (let i = 0; i < candidates.length; i += MIGRATION_CONCURRENCY) {
      const batch = candidates.slice(i, i + MIGRATION_CONCURRENCY);
      await Promise.all(batch.map(async (existing: any) => {
        const st = stations.find(s => s.id === existing.stationId);
        if (!st) return;
        const colName = st.mongoCollections?.meter || st.name;
        if (!colName) return;
        const col = meterDb.collection(colName);
        const set: any = {};

        if (existing.meter1ChangedAt == null && existing.meter1 != null) {
          const oldest: any = await col.findOne(
            { 'payload.meter1': existing.meter1 },
            { sort: { _id: 1 } },
          ).catch(() => null);
          if (oldest) {
            const ts = oldest.receivedAt || oldest.payload?.timestamp1 || oldest.payload?.timestamp;
            if (ts) set.meter1ChangedAt = new Date(ts);
          }
        }
        if (existing.meter2ChangedAt == null && existing.meter2 != null) {
          const oldest: any = await col.findOne(
            { 'payload.meter2': existing.meter2 },
            { sort: { _id: 1 } },
          ).catch(() => null);
          if (oldest) {
            const ts = oldest.receivedAt || oldest.payload?.timestamp2 || oldest.payload?.timestamp;
            if (ts) set.meter2ChangedAt = new Date(ts);
          }
        }

        if (Object.keys(set).length > 0) {
          await stDb.collection('_meter_latest').updateOne(
            { stationId: existing.stationId },
            { $set: set },
          ).catch(() => {});
        }
        done++;
      }));
    }
    console.log(`[meter] backfilled meterChangedAt for ${done}/${candidates.length} stations in ${Math.round((Date.now() - tStart) / 1000)}s`);
  } catch (err: any) {
    console.error('[meter] backfillMeterChangedAt error:', err?.message || err);
  }
}

export function registerMeterStation(stationId: string, collectionName: string): void {
  const prev = meterCollections.get(stationId);
  if (collectionName) {
    meterCollections.set(stationId, collectionName);
    if (prev !== collectionName) {
      console.log(`[meter] ${stationId} → meter.${collectionName}`);
    }
  } else {
    meterCollections.delete(stationId);
  }
}

// Backpressure: cap the number of in-flight insertOne()s per station so a slow
// Mongo can't accumulate millions of pending Promises and exhaust the heap.
const meterPending = new Map<string, number>();
const METER_PENDING_LIMIT = 50;
let meterDropCount = 0;

async function forwardMeter(stationId: string, topic: string, payload: any): Promise<void> {
  const collectionName = meterCollections.get(stationId);
  if (!collectionName) {
    console.warn(`[meter] no collection configured for ${stationId} — skipping forward`);
    return;
  }

  const pending = meterPending.get(stationId) || 0;
  if (pending >= METER_PENDING_LIMIT) {
    meterDropCount++;
    if (meterDropCount % 100 === 1) {
      console.warn(`[meter] backpressure: dropping write for ${stationId} (${pending} pending, ${meterDropCount} total drops)`);
    }
    return;
  }
  meterPending.set(stationId, pending + 1);

  try {
    const db = getDbByName(METER_DB);
    await db.collection(collectionName).insertOne({
      topic,
      payload,
      qos: 0,
      retain: false,
      receivedAt: new Date(),
    });
  } catch (err: any) {
    console.error(`[meter] forward error (${stationId} → ${collectionName}):`, err.message);
  } finally {
    meterPending.set(stationId, (meterPending.get(stationId) || 1) - 1);
  }
}

export function initMeterHandler(): void {
  onMessage('meter', (stationId, topic, payload) => {
    const state = getState(stationId);
    state.meter = payload;

    forwardMeter(stationId, topic, payload);
    cacheMeterLatest(stationId, payload);
    broadcast('meter', stationId, payload);
  });
}
