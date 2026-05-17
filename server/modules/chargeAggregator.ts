/**
 * Charge Aggregator
 *
 * Scans the per-station `meter.{station}` collections every 15 min and writes
 * a daily summary into Station DB's `_charge_daily` collection:
 *
 *   { stationId, date: "YYYY-MM-DD", head1: { sessions, totalKwh },
 *     head2: { sessions, totalKwh }, updatedAt }
 *
 * Session counting matches the reference Python script: every step where the
 * meter value increases counts as one session (so a 30-min continuous charge
 * with 1-min meter ticks shows up as ~30 sessions).
 *
 * Aggregator only re-computes "today" + "yesterday". Older days are written
 * once on yesterday's first post-midnight tick and then frozen.
 */

import { getDbByName, getStationDb } from '../mongo';

interface StationLike {
  id: string;
  name: string;
  mongoCollections?: { meter?: string };
}

interface HeadAggregate {
  sessions: number;
  totalKwh: number;
}

interface DailyAggregate {
  date: string;       // YYYY-MM-DD
  head1: HeadAggregate;
  head2: HeadAggregate;
}

const METER_DB = 'meter';
const AGG_COLLECTION = '_charge_daily';
const TICK_MS = 15 * 60 * 1000;

let inflight = false;

function localDateKey(ts: string | Date | undefined | null): string | null {
  if (!ts) return null;
  const d = ts instanceof Date ? ts : new Date(ts);
  if (isNaN(d.getTime())) return null;
  // Use UTC-based date so it matches the timestamps written by meter MQTT
  // messages (which are also formatted as ISO strings).
  return d.toISOString().slice(0, 10);
}

/** Compute aggregates for a single station over the docs we just fetched */
function aggregateDocs(docs: any[]): Map<string, DailyAggregate> {
  const byDate = new Map<string, DailyAggregate>();
  const ensure = (date: string): DailyAggregate => {
    let a = byDate.get(date);
    if (!a) {
      a = { date, head1: { sessions: 0, totalKwh: 0 }, head2: { sessions: 0, totalKwh: 0 } };
      byDate.set(date, a);
    }
    return a;
  };

  let prevMeter1: number | null = null;
  let prevMeter2: number | null = null;

  for (const doc of docs) {
    const p = doc?.payload || {};
    const m1 = p.meter1 != null ? Number(p.meter1) : null;
    const m2 = p.meter2 != null ? Number(p.meter2) : null;
    const ts1 = p.timestamp1 || p.timestamp;
    const ts2 = p.timestamp2 || p.timestamp;

    if (m1 != null && !isNaN(m1)) {
      const date = localDateKey(ts1);
      if (date && prevMeter1 != null && m1 !== prevMeter1) {
        const deltaWh = m1 - prevMeter1;
        if (deltaWh > 0) {
          const agg = ensure(date);
          agg.head1.sessions++;
          agg.head1.totalKwh += deltaWh / 1000;
        }
      }
      prevMeter1 = m1;
    }

    if (m2 != null && !isNaN(m2)) {
      const date = localDateKey(ts2);
      if (date && prevMeter2 != null && m2 !== prevMeter2) {
        const deltaWh = m2 - prevMeter2;
        if (deltaWh > 0) {
          const agg = ensure(date);
          agg.head2.sessions++;
          agg.head2.totalKwh += deltaWh / 1000;
        }
      }
      prevMeter2 = m2;
    }
  }

  return byDate;
}

async function aggregateOneStation(st: StationLike, dateRange: { start: Date; end: Date }): Promise<number> {
  const colName = st.mongoCollections?.meter || st.name;
  if (!colName) return 0;

  const meterDb = getDbByName(METER_DB);
  const stDb = getStationDb();

  // Pull docs for the window. We sort by _id (insertion order) which matches
  // arrival order — same as the Python script. The window covers from 1 day
  // before `dateRange.start` so the very first delta of `start` has a sane
  // baseline.
  const queryStart = new Date(dateRange.start.getTime() - 86_400_000);
  const queryEnd   = new Date(dateRange.end.getTime() + 86_400_000);

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

  // Only write the dates we actually care about (today + yesterday).
  const wantDates = new Set<string>();
  for (let t = dateRange.start.getTime(); t <= dateRange.end.getTime(); t += 86_400_000) {
    wantDates.add(localDateKey(new Date(t))!);
  }

  const ops = [...aggregates.entries()]
    .filter(([date]) => wantDates.has(date))
    .map(([date, agg]) => ({
      updateOne: {
        filter: { stationId: st.id, date },
        update: {
          $set: {
            stationId: st.id,
            date,
            head1: { sessions: agg.head1.sessions, totalKwh: Number(agg.head1.totalKwh.toFixed(3)) },
            head2: { sessions: agg.head2.sessions, totalKwh: Number(agg.head2.totalKwh.toFixed(3)) },
            updatedAt: new Date(),
          },
        },
        upsert: true,
      },
    } as const));

  // Also stamp empty days (no meter activity) so the API can return them.
  for (const date of wantDates) {
    if (!aggregates.has(date)) {
      ops.push({
        updateOne: {
          filter: { stationId: st.id, date },
          update: {
            $set: {
              stationId: st.id,
              date,
              head1: { sessions: 0, totalKwh: 0 },
              head2: { sessions: 0, totalKwh: 0 },
              updatedAt: new Date(),
            },
          },
          upsert: true,
        },
      } as const);
    }
  }

  if (ops.length > 0) {
    await stDb.collection(AGG_COLLECTION).bulkWrite(ops, { ordered: false }).catch(() => {});
  }
  return docs.length;
}

/** Run the aggregator once. Reentrant — concurrent ticks skip. */
async function runAggregation(stations: StationLike[]): Promise<void> {
  if (inflight) {
    console.log('[chargeAgg] previous run still in flight — skipping');
    return;
  }
  inflight = true;
  const tStart = Date.now();
  try {
    // Window: today (UTC) + yesterday
    const now = new Date();
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const yesterdayStart = new Date(todayStart.getTime() - 86_400_000);

    let totalDocs = 0;
    const CONCURRENCY = 10;
    for (let i = 0; i < stations.length; i += CONCURRENCY) {
      const batch = stations.slice(i, i + CONCURRENCY);
      const counts = await Promise.all(batch.map(st =>
        aggregateOneStation(st, { start: yesterdayStart, end: todayStart }).catch(() => 0),
      ));
      totalDocs += counts.reduce((a, b) => a + b, 0);
    }

    console.log(`[chargeAgg] aggregated ${stations.length} stations, ${totalDocs} meter docs in ${Date.now() - tStart}ms`);
  } catch (err: any) {
    console.error('[chargeAgg] error:', err?.message || err);
  } finally {
    inflight = false;
  }
}

/**
 * Start the aggregator. Runs immediately on startup (so /api/charging works
 * the moment the page loads), then every 15 min.
 */
export function startChargeAggregator(getStations: () => StationLike[]): void {
  // Initial run after 10s so MQTT + station registration have time to settle.
  setTimeout(() => { runAggregation(getStations()); }, 10_000);
  setInterval(() => { runAggregation(getStations()); }, TICK_MS);
}
