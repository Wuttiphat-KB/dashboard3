import { NextRequest, NextResponse } from 'next/server';
import { getMongoClient } from '@/lib/mongoClient';

const STATION_DB     = 'Station';
const AGG_COLLECTION = '_peak_hourly';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * GET /api/statistics/peak-hours?from=2026-05-01&to=2026-05-15
 *
 * Fleet-wide peak hour analytics. Reads pre-aggregated `_peak_hourly` docs
 * (written by server/modules/peakHoursAggregator.ts) and reduces them into
 * two views:
 *
 *   hourly[24]      — total + avg kWh per hour-of-day (0..23)
 *   heatmap[7][24]  — kWh per (day-of-week, hour-of-day), Sun..Sat
 *
 * Plus summary totals: peak hour, peak day, total kWh, station count.
 */
export async function GET(req: NextRequest) {
  try {
    const url  = new URL(req.url);
    const from = url.searchParams.get('from');
    const to   = url.searchParams.get('to');

    if (!from || !to) {
      return NextResponse.json({ error: 'from and to (YYYY-MM-DD) are required' }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return NextResponse.json({ error: 'from and to must be YYYY-MM-DD' }, { status: 400 });
    }

    const client = await getMongoClient();
    const docs = await client.db(STATION_DB).collection(AGG_COLLECTION)
      .find({ date: { $gte: from, $lte: to } })
      .toArray();

    // ── Roll-ups ───────────────────────────────────────────────────────────
    const hourlyTotals = new Array<number>(24).fill(0);
    const hourlyDayCount = new Array<Set<string>>(24);
    for (let i = 0; i < 24; i++) hourlyDayCount[i] = new Set();

    // heatmap[day 0..6][hour 0..23] = kWh
    const heatmap: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
    const dailyTotals: number[] = new Array(7).fill(0);

    const stationSet = new Set<string>();
    let totalKwh = 0;

    for (const d of docs) {
      const kwh = Number(d.kwh || 0);
      const hourOfDay = Number(d.hourOfDay);
      const date = String(d.date || '');
      if (!(hourOfDay >= 0 && hourOfDay <= 23) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

      hourlyTotals[hourOfDay] += kwh;
      hourlyDayCount[hourOfDay].add(date);
      totalKwh += kwh;
      if (d.stationId) stationSet.add(String(d.stationId));

      // Day of week from the date string (treat as UTC to avoid tz drift —
      // the aggregator writes the payload's local date, so Sunday-in-Thailand
      // stays Sunday here).
      const [y, m, day] = date.split('-').map(n => parseInt(n, 10));
      const dow = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
      heatmap[dow][hourOfDay] += kwh;
      dailyTotals[dow] += kwh;
    }

    const hourly = hourlyTotals.map((total, i) => {
      const days = hourlyDayCount[i].size || 1;
      return {
        hour: i,
        totalKwh: Number(total.toFixed(2)),
        avgKwh: Number((total / days).toFixed(2)),
      };
    });

    // Round heatmap for cleaner JSON
    const heatmapRounded = heatmap.map(row => row.map(v => Number(v.toFixed(2))));

    // ── Peak identification ────────────────────────────────────────────────
    let peakHour = 0, peakHourValue = 0;
    for (let i = 0; i < 24; i++) {
      if (hourlyTotals[i] > peakHourValue) { peakHourValue = hourlyTotals[i]; peakHour = i; }
    }
    let peakDay = 0, peakDayValue = 0;
    for (let i = 0; i < 7; i++) {
      if (dailyTotals[i] > peakDayValue) { peakDayValue = dailyTotals[i]; peakDay = i; }
    }

    // Contribution of peak hour to total (business insight)
    const peakHourPct = totalKwh > 0 ? (peakHourValue / totalKwh) * 100 : 0;

    // Days in the range (inclusive)
    const fromD = new Date(from + 'T00:00:00Z').getTime();
    const toD   = new Date(to   + 'T00:00:00Z').getTime();
    const days  = Math.round((toD - fromD) / 86_400_000) + 1;

    return NextResponse.json({
      range: { from, to, days },
      hourly,
      heatmap: heatmapRounded,
      dayNames: DAY_NAMES,
      totals: {
        totalKwh:      Number(totalKwh.toFixed(2)),
        peakHour,
        peakHourValue: Number(peakHourValue.toFixed(2)),
        peakHourPct:   Number(peakHourPct.toFixed(1)),
        peakDay,
        peakDayName:   DAY_NAMES[peakDay],
        peakDayValue:  Number(peakDayValue.toFixed(2)),
        stationCount:  stationSet.size,
      },
    });
  } catch (err: any) {
    console.error('[api/peak-hours] error:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
}
