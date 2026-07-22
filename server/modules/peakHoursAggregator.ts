/**
 * Peak Hours Aggregator
 *
 * Scans per-station `meter.{station}` collections and writes hourly kWh totals
 * to Station DB's `_peak_hourly` collection:
 *
 *   { stationId, hour: "YYYY-MM-DDTHH",
 *     date: "YYYY-MM-DD", hourOfDay: 0..23,
 *     kwh, updatedAt }
 *
 * Uniqueness enforced by filter `{ stationId, hour }` on upsert.
 *
 * The frontend's /api/statistics/peak-hours route sums across all stations for
 * each hour bucket, so the fleet-wide view aggregates fast without touching
 * the per-station meter collections at read time.
 *
 * Hour bucketing uses the payload timestamp string as-is (Thailand local time
 * for both Phoenix hardware and Vector backend-generated timestamps), so a
 * "peak at 18:00" bucket lines up with 18:00 Thailand — not UTC.
 *
 * Cadence mirrors chargeAggregator: 30-day backfill on startup, then every
 * 15 min refresh only today + yesterday.
 */

import { getDbByName, getStationDb } from '../mongo';

interface StationLike {
  id: string;
  name: string;
  mongoCollections?: { meter?: string };
}

const METER_DB       = 'meter';
const AGG_COLLECTION = '_peak_hourly';
const TICK_MS        = 15 * 60 * 1000;
const BACKFILL_DAYS  = 30;

let inflight = false;
let backfillDone = false;

/**
 * Extract { date, hour } from a payload timestamp string like
 * "2026-05-29T14:30:45.123" — treats the payload as authoritative local time
 * (Thailand for both Phoenix hardware and Vector backend). Returns null if
 * the string isn't a recognisable ISO date.
 */
function hourBucket(ts: string | undefined | null): { date: string; hourOfDay: number; hour: string } | null {
  if (!ts || typeof ts !== 'string' || ts.length < 13) return null;
  const date = ts.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const hourStr = ts.slice(11, 13);
  const hourOfDay = parseInt(hourStr, 10);
  if (isNaN(hourOfDay) || hourOfDay < 0 || hourOfDay > 23) return null;
  return { date, hourOfDay, hour: `${date}T${hourStr}` };
}

/**
 * Walk a sorted list of meter docs and produce per-hour kWh totals.
 * kwh = (meter1_delta + meter2_delta) / 1000, delta only counted if positive.
 */
function aggregateDocs(docs: any[]): Map<string, { date: string; hourOfDay: number; kwh: number }> {
  const byHour = new Map<string, { date: string; hourOfDay: number; kwh: number }>();
  const bump = (bucket: { date: string; hourOfDay: number; hour: string }, wh: number) => {
    let e = byHour.get(bucket.hour);
    if (!e) {
      e = { date: bucket.date, hourOfDay: bucket.hourOfDay, kwh: 0 };
      byHour.set(bucket.hour, e);
    }
    e.kwh += wh / 1000;
  };

  let prev1: number | null = null;
  let prev2: number | null = null;

  for (const doc of docs) {
    const p = doc?.payload || {};
    const m1  = p.meter1 != null ? Number(p.meter1) : null;
    const m2  = p.meter2 != null ? Number(p.meter2) : null;
    const ts1 = p.timestamp1 || p.timestamp;
    const ts2 = p.timestamp2 || p.timestamp;

    if (m1 != null && !isNaN(m1)) {
      const b = hourBucket(ts1);
      if (b && prev1 != null && m1 > prev1) bump(b, m1 - prev1);
      prev1 = m1;
    }
    if (m2 != null && !isNaN(m2)) {
      const b = hourBucket(ts2);
      if (b && prev2 != null && m2 > prev2) bump(b, m2 - prev2);
      prev2 = m2;
    }
  }
  return byHour;
}

async function aggregateOneStation(st: StationLike, dateRange: { start: Date; end: Date }): Promise<number> {
  const colName = st.mongoCollections?.meter || st.name;
  if (!colName) return 0;

  const meterDb = getDbByName(METER_DB);
  const stDb    = getStationDb();

  // Widen window by 1 day each side so the first delta of `start` has a baseline.
  const queryStart = new Date(dateRange.start.getTime() - 86_400_000);
  const queryEnd   = new Date(dateRange.end.getTime()   + 86_400_000);

  const docs = await meterDb.collection(colName)
    .find({
      $or: [
        { receivedAt: { $gte: queryStart, $lt: queryEnd } },
        { 'payload.timestamp': { $gte: queryStart.toISOString(), $lt: queryEnd.toISOString() } },
      ],
    })
    .sort({ _id: 1 })
    .toArray()
    .catch(() => []);

  if (docs.length === 0) return 0;

  const aggregates = aggregateDocs(docs);

  // Only write hours that fall inside the target window's date range
  // (dates YYYY-MM-DD between start and end, inclusive).
  const startDate = dateRange.start.toISOString().slice(0, 10);
  const endDate   = dateRange.end.toISOString().slice(0, 10);

  const ops = [...aggregates.entries()]
    .filter(([, agg]) => agg.date >= startDate && agg.date <= endDate)
    .map(([hour, agg]) => ({
      updateOne: {
        filter: { stationId: st.id, hour },
        update: {
          $set: {
            stationId: st.id,
            hour,
            date: agg.date,
            hourOfDay: agg.hourOfDay,
            kwh: Number(agg.kwh.toFixed(3)),
            updatedAt: new Date(),
          },
        },
        upsert: true,
      },
    } as const));

  if (ops.length > 0) {
    await stDb.collection(AGG_COLLECTION).bulkWrite(ops, { ordered: false }).catch(() => {});
  }
  return docs.length;
}

const BACKFILL_CONCURRENCY = 5;
const TICK_CONCURRENCY     = 10;

async function backfillPeaks(stations: StationLike[]): Promise<void> {
  if (backfillDone) return;
  if (inflight) return;
  inflight = true;
  const tStart = Date.now();
  try {
    const now = new Date();
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const startDate  = new Date(todayStart.getTime() - (BACKFILL_DAYS - 1) * 86_400_000);

    console.log(`[peakAgg] backfilling ${BACKFILL_DAYS} days (${startDate.toISOString().slice(0, 10)} → ${todayStart.toISOString().slice(0, 10)})...`);

    let totalDocs = 0;
    let done = 0;
    for (let i = 0; i < stations.length; i += BACKFILL_CONCURRENCY) {
      const batch = stations.slice(i, i + BACKFILL_CONCURRENCY);
      const counts = await Promise.all(batch.map(st =>
        aggregateOneStation(st, { start: startDate, end: todayStart }).catch(() => 0),
      ));
      totalDocs += counts.reduce((a, b) => a + b, 0);
      done += batch.length;
      if (done % 50 === 0 || done === stations.length) {
        console.log(`[peakAgg] backfill progress: ${done}/${stations.length} stations`);
      }
    }
    backfillDone = true;
    console.log(`[peakAgg] backfill complete: ${stations.length} stations, ${totalDocs} meter docs in ${Math.round((Date.now() - tStart) / 1000)}s`);
  } catch (err: any) {
    console.error('[peakAgg] backfill error:', err?.message || err);
  } finally {
    inflight = false;
  }
}

async function runAggregation(stations: StationLike[]): Promise<void> {
  if (inflight) {
    console.log('[peakAgg] previous run still in flight — skipping');
    return;
  }
  inflight = true;
  const tStart = Date.now();
  try {
    const now = new Date();
    const todayStart     = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const yesterdayStart = new Date(todayStart.getTime() - 86_400_000);

    let totalDocs = 0;
    for (let i = 0; i < stations.length; i += TICK_CONCURRENCY) {
      const batch = stations.slice(i, i + TICK_CONCURRENCY);
      const counts = await Promise.all(batch.map(st =>
        aggregateOneStation(st, { start: yesterdayStart, end: todayStart }).catch(() => 0),
      ));
      totalDocs += counts.reduce((a, b) => a + b, 0);
    }

    console.log(`[peakAgg] aggregated ${stations.length} stations, ${totalDocs} meter docs in ${Date.now() - tStart}ms`);
  } catch (err: any) {
    console.error('[peakAgg] error:', err?.message || err);
  } finally {
    inflight = false;
  }
}

/**
 * Backfill 30 days for one newly-added station. Called from the auto-reload
 * loop so new stations show hourly peaks without a backend restart.
 */
export async function backfillPeakStation(st: StationLike): Promise<void> {
  try {
    const now = new Date();
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const startDate  = new Date(todayStart.getTime() - (BACKFILL_DAYS - 1) * 86_400_000);
    const tStart = Date.now();
    const docs = await aggregateOneStation(st, { start: startDate, end: todayStart });
    console.log(`[peakAgg] backfilled ${st.id}: ${docs} docs in ${Date.now() - tStart}ms`);
  } catch (err: any) {
    console.error(`[peakAgg] backfillPeakStation(${st.id}) failed:`, err?.message || err);
  }
}

/**
 * Start the aggregator. Backfill kicks off 15s after startup (offset from
 * chargeAggregator's 10s so they don't both hammer Mongo at once); after
 * backfill enter the 15-min tick.
 */
export function startPeakHoursAggregator(getStations: () => StationLike[]): void {
  setTimeout(() => {
    backfillPeaks(getStations()).then(() => {
      setInterval(() => { runAggregation(getStations()); }, TICK_MS);
    });
  }, 15_000);
}
