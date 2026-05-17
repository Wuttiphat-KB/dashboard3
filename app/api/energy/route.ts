import { NextRequest, NextResponse } from 'next/server';
import { getMongoClient } from '@/lib/mongoClient';

const STATION_DB = 'Station';
const AGG_COLLECTION = '_charge_daily';

/**
 * GET /api/energy?stationId=BKN1&start=2026-05-01&end=2026-05-15
 *
 * Returns the pre-computed daily charge summary for a single station.
 * The aggregator (server/modules/chargeAggregator.ts) refreshes today +
 * yesterday every 15 min; older days are read-only.
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const stationId = url.searchParams.get('stationId');
    const start = url.searchParams.get('start'); // YYYY-MM-DD inclusive
    const end   = url.searchParams.get('end');   // YYYY-MM-DD inclusive

    if (!stationId) {
      return NextResponse.json({ error: 'stationId is required' }, { status: 400 });
    }
    if (!start || !end) {
      return NextResponse.json({ error: 'start and end (YYYY-MM-DD) are required' }, { status: 400 });
    }

    const client = await getMongoClient();
    const docs = await client.db(STATION_DB).collection(AGG_COLLECTION)
      .find({
        stationId,
        date: { $gte: start, $lte: end },
      })
      .sort({ date: 1 })
      .toArray();

    // Fill missing days with zero entries so the chart has continuous x-axis.
    const byDate = new Map(docs.map(d => [d.date, d]));
    const out: any[] = [];
    const startD = new Date(start + 'T00:00:00Z');
    const endD   = new Date(end   + 'T00:00:00Z');
    for (let t = startD.getTime(); t <= endD.getTime(); t += 86_400_000) {
      const date = new Date(t).toISOString().slice(0, 10);
      const existing = byDate.get(date);
      if (existing) {
        out.push({
          date,
          head1: existing.head1 || { sessions: 0, totalKwh: 0 },
          head2: existing.head2 || { sessions: 0, totalKwh: 0 },
          updatedAt: existing.updatedAt || null,
        });
      } else {
        out.push({
          date,
          head1: { sessions: 0, totalKwh: 0 },
          head2: { sessions: 0, totalKwh: 0 },
          updatedAt: null,
        });
      }
    }

    return NextResponse.json(out);
  } catch (err: any) {
    console.error('[api/charging] error:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
}
