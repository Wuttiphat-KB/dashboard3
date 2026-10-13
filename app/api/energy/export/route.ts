import { NextRequest, NextResponse } from 'next/server';
import { getMongoClient } from '@/lib/mongoClient';
import { getRequestSession, visibleStationIds } from '@/lib/authorization';
import { loadStations } from '@/lib/stationRepository';
import { buildXlsx, XlsxCell } from '@/lib/xlsx';

const METER_DB = 'meter';
const RATE = 7.5;
const MAX_DAYS = 92;

/**
 * GET /api/energy/export?stationId=BKN1&start=2026-05-01&end=2026-05-15
 *
 * Returns an Excel (.xlsx) of raw meter deltas for one station
 * (colored header row, borders on every cell):
 *   timestamp, connector, kW, Price (kW*7.5)
 *
 * Same delta logic as the charge aggregator: meter values are cumulative Wh,
 * every positive change between consecutive readings becomes one row
 * (delta / 1000). Date filter uses the payload timestamp's date (local time).
 */
export async function GET(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const url = new URL(req.url);
    const stationId = url.searchParams.get('stationId');
    const start = url.searchParams.get('start');
    const end   = url.searchParams.get('end');
    const format = url.searchParams.get('format') === 'csv' ? 'csv' : 'xlsx';

    if (!stationId) return NextResponse.json({ error: 'stationId is required' }, { status: 400 });
    if (!start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      return NextResponse.json({ error: 'start and end (YYYY-MM-DD) are required' }, { status: 400 });
    }
    if (start > end) return NextResponse.json({ error: 'start must be <= end' }, { status: 400 });

    const startD = new Date(start + 'T00:00:00Z');
    const endD   = new Date(end   + 'T00:00:00Z');
    if ((endD.getTime() - startD.getTime()) / 86_400_000 + 1 > MAX_DAYS) {
      return NextResponse.json({ error: `Range too large (max ${MAX_DAYS} days)` }, { status: 400 });
    }

    const client = await getMongoClient();
    const allowedIds = await visibleStationIds(session, client);
    if (allowedIds !== null && !allowedIds.includes(stationId)) {
      return NextResponse.json({ error: 'Station not found' }, { status: 404 });
    }

    const stations = await loadStations(client);
    const st = stations.find((s: any) => s.id === stationId);
    const colName: string | undefined = st?.mongoCollections?.meter || st?.name;
    if (!colName) return NextResponse.json({ error: 'Meter collection not configured' }, { status: 404 });

    // Widen by 1 day each side: baseline for the first delta + timezone slack.
    const queryStart = new Date(startD.getTime() - 86_400_000);
    const queryEnd   = new Date(endD.getTime() + 2 * 86_400_000);

    const cursor = client.db(METER_DB).collection(colName)
      .find(
        {
          $or: [
            { receivedAt: { $gte: queryStart, $lt: queryEnd } },
            { 'payload.timestamp': { $gte: queryStart.toISOString(), $lt: queryEnd.toISOString() } },
          ],
        },
        { projection: { payload: 1, receivedAt: 1 } },
      )
      .sort({ _id: 1 });

    const rows: XlsxCell[][] = [];
    const prev: Record<1 | 2, number | null> = { 1: null, 2: null };

    const tsString = (v: any, fallback: any): string => {
      if (typeof v === 'string' && v) return v;
      if (v instanceof Date) return v.toISOString();
      if (fallback instanceof Date) return fallback.toISOString();
      return '';
    };

    for await (const doc of cursor) {
      const p: any = doc?.payload || {};
      for (const head of [1, 2] as const) {
        const raw = p[`meter${head}`];
        if (raw == null) continue;
        const m = Number(raw);
        if (isNaN(m)) continue;
        const last = prev[head];
        prev[head] = m;
        if (last == null) continue;
        const deltaWh = m - last;
        if (!(deltaWh > 0)) continue;

        const ts = tsString(p[`timestamp${head}`] || p.timestamp, doc.receivedAt);
        const date = ts.slice(0, 10);
        if (!date || date < start || date > end) continue;

        const kw = deltaWh / 1000;
        rows.push([ts, head, Number(kw.toFixed(3)), Number((kw * RATE).toFixed(3))]);
      }
    }

    if (format === 'csv') {
      const lines = ['timestamp,connector,kW,Price'];
      for (const r of rows) lines.push(`${r[0]},${r[1]},${Number(r[2]).toFixed(3)},${Number(r[3]).toFixed(3)}`);
      const csvName = `energy_${stationId}_${start}_${end}.csv`.replace(/[^\w.\-]/g, '_');
      return new NextResponse('\uFEFF' + lines.join('\r\n') + '\r\n', {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${csvName}"`,
          'Cache-Control': 'private, no-store',
        },
      });
    }

    const xlsx = buildXlsx('Energy', [
      { header: 'timestamp', width: 26 },
      { header: 'connector', width: 12, numFmt: 'int' },
      { header: 'kW',        width: 12, numFmt: '0.000' },
      { header: 'Price',     width: 12, numFmt: '0.000' },
    ], rows);
    const filename = `energy_${stationId}_${start}_${end}.xlsx`.replace(/[^\w.\-]/g, '_');
    return new NextResponse(new Uint8Array(xlsx), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err: any) {
    console.error('[api/energy/export] error:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
}
