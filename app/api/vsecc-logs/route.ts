import { NextRequest, NextResponse } from 'next/server';
import { getMongoClient } from '@/lib/mongoClient';
import { getRequestSession } from '@/lib/authorization';
import { loadStations } from '@/lib/stationRepository';
import { vseccBaseUrl, vseccGet, isSafeLogName, VseccError } from '@/lib/vsecc';
import { isNetworkId, withStationNetwork, ZeroTierError } from '@/lib/zerotier';
import {
  collectStation, collectorStatus, storedFileNames, storedState, storedStream, storedTail, safeStationId,
} from '@/lib/vseccStore';
import { audit } from '@/lib/audit';
import { canViewStation } from '@/lib/stationAccess';

const MAX_TAIL_LINES = 5000;

function pickDefault(files: string[]): string {
  return files.find(f => f.startsWith('charging-manager')) || files[0] || '';
}

/**
 * Logs are collected in the background every ~30 s and stored on disk
 * (lib/vseccStore.ts); viewing reads that store, so it is instant.
 *
 * GET /api/vsecc-logs?stationId=X&withList=1&tail=500   → { files, name, lines, collector, ... }  (first open)
 * GET /api/vsecc-logs?stationId=X&name=F&tail=500       → { name, lines, collector, ... }        (auto-refresh)
 *   add &fresh=1 → pull new lines from the charger right now, then read the store
 * GET /api/vsecc-logs?stationId=X&name=F&stored=1       → stored copy (up to 7 days) as attachment
 * GET /api/vsecc-logs?stationId=X&name=F&download=1     → current file straight from the charger
 * GET /api/vsecc-logs?stationId=X&zip=1                 → all logs as zip, straight from the charger
 *
 * Admins: any Vector station. Customers: only their own customer's stations.
 * Read-only — nothing here deletes logs on the charger.
 */
export async function GET(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const stationId = url.searchParams.get('stationId');
  let name = url.searchParams.get('name');
  if (!stationId) return NextResponse.json({ error: 'stationId is required' }, { status: 400 });
  if (name && !isSafeLogName(name)) return NextResponse.json({ error: 'Invalid file name' }, { status: 400 });

  const t0 = Date.now();
  try {
    const stations = await loadStations(await getMongoClient());
    const st = stations.find((s: any) => s.id === stationId || s.name === stationId);
    // Out-of-scope stations look exactly like missing ones.
    if (!st || !canViewStation(session, st)) return NextResponse.json({ error: 'Station not found' }, { status: 404 });
    if (st.controllerType !== 'vector') {
      return NextResponse.json({ error: 'Log Manager is only available for Vector stations' }, { status: 400 });
    }
    const sid = String(st.id);
    const safeId = safeStationId(sid);
    const zip = url.searchParams.get('zip') === '1';
    const download = url.searchParams.get('download') === '1';
    const stored = url.searchParams.get('stored') === '1';
    const withList = url.searchParams.get('withList') === '1';
    const fresh = url.searchParams.get('fresh') === '1';
    const tail = Math.min(Math.max(Number(url.searchParams.get('tail')) || 500, 1), MAX_TAIL_LINES);

    if (zip || download || stored) void audit(session, 'vsecc_log_download', { req, target: sid, details: { file: zip ? '(all, zip)' : name, stored } });
    else if (withList) void audit(session, 'vsecc_log_view', { req, target: sid, details: { fresh } });

    // ── Stored copy download ──
    if (stored) {
      if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
      const body = await storedStream(sid, name);
      if (!body) return NextResponse.json({ error: 'Nothing stored for this log yet' }, { status: 404 });
      return new NextResponse(body, { headers: attachment('text/plain; charset=utf-8', `${safeId}_${name.replace(/\.log$/, '')}_stored.log`) });
    }

    // ── Live from the charger (download / zip) ──
    if (zip || download) {
      if (download && !name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
      const base = vseccBaseUrl(st);
      const work = async () => {
        const res = await vseccGet(base, zip ? '/logging/files' : `/logging/files/${encodeURIComponent(name!)}`, zip ? 180_000 : 120_000, sid);
        const buf = await res.arrayBuffer();        // read fully before the network can switch
        console.log(`[api/vsecc-logs] ${sid} ${zip ? 'zip' : `download ${name}`} bytes=${buf.byteLength} total=${Date.now() - t0}ms`);
        return zip
          ? new NextResponse(buf, { headers: attachment('application/zip', `vsecc_logs_${safeId}.zip`) })
          : new NextResponse(buf, { headers: attachment('application/octet-stream', `${safeId}_${name}`) });
      };
      if (!st.vseccApiUrl && isNetworkId(st.zerotierIp)) {
        return await withStationNetwork(st.zerotierIp.trim(), stations.map((s: any) => s.zerotierIp).filter(isNetworkId), work);
      }
      return await work();
    }

    // ── Viewer: read the store (pull first on ↻ Refresh or if nothing is stored yet) ──
    let state = await storedState(sid);
    let pulled = false;
    if (fresh || !state) {
      state = await collectStation(st, stations);
      pulled = true;
      // First-ever pull failed → surface the error like before.
      if (state.lastError && !state.lastOkAt) throw new VseccError(state.lastError);
    }

    let files: string[] | undefined;
    if (withList || !name) {
      files = await storedFileNames(sid);
      if (!name) name = pickDefault(files);
    }
    const lines = name ? await storedTail(sid, name, tail) : [];
    const total = Date.now() - t0;
    return NextResponse.json({
      ...(files ? { files } : {}),
      name: name || '',
      totalLines: null,
      lines,
      partial: true,
      fetchedAt: state.lastOkAt || null,
      collector: {
        ...collectorStatus(),
        lastRunAt: state.lastRunAt || null,
        lastOkAt: state.lastOkAt || null,
        // Raw errors can include network IDs / config names — admins only.
        lastError: state.lastError ? (session.role === 'admin' ? state.lastError : 'Charger not reachable on the last attempt') : null,
      },
      timing: { network: 0, charger: pulled ? state.lastDurationMs || 0 : 0, bytes: 0, cached: !pulled, totalMs: total },
    }, { headers: { 'Cache-Control': 'private, no-store', 'Server-Timing': `total;dur=${total}` } });
  } catch (err: any) {
    const status = err instanceof VseccError || err instanceof ZeroTierError ? err.status : 500;
    console.error(`[api/vsecc-logs] error after ${Date.now() - t0}ms (${session.username}):`, err?.message || err);
    // Admins get the real cause (network IDs, config names, route conflicts…); customers a plain message.
    const message = session.role === 'admin'
      ? err?.message || 'Unknown error'
      : status === 504 || status === 502 ? 'Cannot reach the charger right now — please try again later.'
      : 'Log is not available for this station right now.';
    return NextResponse.json({ error: message }, { status });
  }
}

function attachment(type: string, filename: string): Record<string, string> {
  return { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'private, no-store' };
}
