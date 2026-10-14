import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession } from '@/lib/authorization';
import { queryAudit } from '@/lib/audit';

/**
 * GET /api/audit?username=&action=&from=YYYY-MM-DD&to=YYYY-MM-DD&page=1&limit=100
 * GET /api/audit?...&format=csv   → CSV download (up to 5000 rows)
 * Admin only. Dates are Thailand local days (UTC+7), `to` inclusive.
 */
export async function GET(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(req.url);
  const day = (v: string | null, addDays = 0) => {
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
    const d = new Date(`${v}T00:00:00+07:00`);
    d.setUTCDate(d.getUTCDate() + addDays);
    return d;
  };
  const csv = url.searchParams.get('format') === 'csv';
  const limit = csv ? 5000 : Number(url.searchParams.get('limit')) || 100;
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);

  try {
    const { rows, total } = await queryAudit({
      username: url.searchParams.get('username')?.trim().toLowerCase() || undefined,
      action: url.searchParams.get('action') || undefined,
      from: day(url.searchParams.get('from')),
      to: day(url.searchParams.get('to'), 1),
      limit: Math.min(limit, csv ? 5000 : 500),
      skip: csv ? 0 : (page - 1) * Math.min(limit, 500),
    });

    if (csv) {
      const esc = (v: unknown) => {
        const s = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
        return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const fmt = (d: any) => new Date(new Date(d).getTime() + 7 * 3_600_000).toISOString().replace('T', ' ').slice(0, 19);
      const lines = ['time (UTC+7),username,role,customer,action,target,ok,ip,details'];
      for (const r of rows as any[]) {
        lines.push([fmt(r.at), r.username, r.role, r.customer, r.action, r.target, r.ok, r.ip, r.details].map(esc).join(','));
      }
      return new NextResponse('﻿' + lines.join('\r\n') + '\r\n', {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="audit_log_${new Date().toISOString().slice(0, 10)}.csv"`,
          'Cache-Control': 'private, no-store',
        },
      });
    }
    return NextResponse.json({ rows, total, page }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err: any) {
    console.error('[api/audit] error:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
}
