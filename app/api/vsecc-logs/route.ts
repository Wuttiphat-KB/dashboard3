import { NextRequest, NextResponse } from 'next/server';
import { getMongoClient } from '@/lib/mongoClient';
import { getRequestSession } from '@/lib/authorization';
import { loadStations } from '@/lib/stationRepository';
import { vseccBaseUrl, vseccGet, isSafeLogName, VseccError } from '@/lib/vsecc';
import { isNetworkId, withStationNetwork, ZeroTierError } from '@/lib/zerotier';

const MAX_TAIL_LINES = 5000;

/**
 * GET /api/vsecc-logs?stationId=X                     → { files: string[] }
 * GET /api/vsecc-logs?stationId=X&name=F&tail=500     → { name, totalLines, lines: string[] }
 * GET /api/vsecc-logs?stationId=X&name=F&download=1   → raw file (attachment)
 * GET /api/vsecc-logs?stationId=X&zip=1               → all logs as zip (attachment)
 *
 * Admin only: logs can contain charger internals and the endpoint reaches into
 * the charger's own API.
 */
export async function GET(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(req.url);
  const stationId = url.searchParams.get('stationId');
  const name = url.searchParams.get('name');
  if (!stationId) return NextResponse.json({ error: 'stationId is required' }, { status: 400 });
  if (name && !isSafeLogName(name)) return NextResponse.json({ error: 'Invalid file name' }, { status: 400 });

  try {
    const stations = await loadStations(await getMongoClient());
    const st = stations.find((s: any) => s.id === stationId || s.name === stationId);
    if (!st) return NextResponse.json({ error: 'Station not found' }, { status: 404 });
    if (st.controllerType !== 'vector') {
      return NextResponse.json({ error: 'Log Manager is only available for Vector stations' }, { status: 400 });
    }
    const base = vseccBaseUrl(st);
    const safeId = String(st.id).replace(/[^\w.\-]/g, '_');
    const zip = url.searchParams.get('zip') === '1';
    const download = url.searchParams.get('download') === '1';
    const tail = Math.min(Math.max(Number(url.searchParams.get('tail')) || 500, 1), MAX_TAIL_LINES);

    // Everything that talks to the charger runs inside work(); bodies are read
    // fully there so the ZeroTier network isn't switched mid-transfer.
    const work = async (): Promise<NextResponse> => {
      const get = (path: string, timeoutMs: number) => vseccGet(base, path, timeoutMs, String(st.id));

      if (zip) {
        const buf = await (await get('/logging/files', 180_000)).arrayBuffer();
        return new NextResponse(buf, {
          headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="vsecc_logs_${safeId}.zip"`,
            'Cache-Control': 'private, no-store',
          },
        });
      }

      if (!name) {
        const files = await (await get('/logging/filenames', 15_000)).json();
        return NextResponse.json({ files: Array.isArray(files) ? files : [] }, { headers: { 'Cache-Control': 'private, no-store' } });
      }

      const res = await get(`/logging/files/${encodeURIComponent(name)}`, 60_000);
      if (download) {
        return new NextResponse(await res.arrayBuffer(), {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${safeId}_${name}"`,
            'Cache-Control': 'private, no-store',
          },
        });
      }

      const all = (await res.text()).split(/\r?\n/);
      if (all.length && all[all.length - 1] === '') all.pop();
      return NextResponse.json(
        { name, totalLines: all.length, lines: all.slice(-tail) },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    };

    // Station field holds a ZeroTier network ID and no explicit URL override →
    // switch this server onto that station's network first.
    if (!st.vseccApiUrl && isNetworkId(st.zerotierIp)) {
      const stationNetworks = stations.map((s: any) => s.zerotierIp).filter(isNetworkId);
      return await withStationNetwork(st.zerotierIp.trim(), stationNetworks, work);
    }
    return await work();
  } catch (err: any) {
    const status = err instanceof VseccError || err instanceof ZeroTierError ? err.status : 500;
    console.error('[api/vsecc-logs] error:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status });
  }
}
