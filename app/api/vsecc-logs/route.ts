import { NextRequest, NextResponse } from 'next/server';
import { getMongoClient } from '@/lib/mongoClient';
import { getRequestSession } from '@/lib/authorization';
import { loadStations } from '@/lib/stationRepository';
import { vseccGet, isSafeLogName, VseccError } from '@/lib/vsecc';
import { ZeroTierError } from '@/lib/zerotier';
import {
  collectStation, collectorStatus, withStationVsecc, storedControllers, storedFileNames, storedState, storedStream, storedTail, safeStationId,
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
 * Add &controller=192.168.3.12 to pick one vSECC when the cabinet has two (default: first one).
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
    let controller = url.searchParams.get('controller') || '';
    if (controller && !/^[\w.\-]{1,100}$/.test(controller)) return NextResponse.json({ error: 'Invalid controller' }, { status: 400 });
    const tail = Math.min(Math.max(Number(url.searchParams.get('tail')) || 500, 1), MAX_TAIL_LINES);

    if (zip || download || stored) void audit(session, 'vsecc_log_download', { req, target: sid, details: { file: zip ? '(all, zip)' : name, stored, controller } });
    else if (withList) void audit(session, 'vsecc_log_view', { req, target: sid, details: { fresh } });

    // ── Stored copy download ──
    if (stored) {
      if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
      const ctrls = await storedControllers(sid);
      const key = controller || ctrls[0]?.key || '';
      const body = key ? await storedStream(sid, key, name) : null;
      if (!body) return NextResponse.json({ error: 'Nothing stored for this log yet' }, { status: 404 });
      return new NextResponse(body, { headers: attachment('text/plain; charset=utf-8', `${safeId}${ctrls.length > 1 ? `_${key}` : ''}_${name.replace(/\.log$/, '')}_stored.log`) });
    }

    // ── Live from the charger (download / zip) ──
    if (zip || download) {
      if (download && !name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
      const work = async (base: string) => {
        const res = await vseccGet(base, zip ? '/logging/files' : `/logging/files/${encodeURIComponent(name!)}`, zip ? 180_000 : 120_000, `${sid}|live`);
        const buf = await res.arrayBuffer();        // read fully before the network can switch
        console.log(`[api/vsecc-logs] ${sid} ${zip ? 'zip' : `download ${name}`} bytes=${buf.byteLength} total=${Date.now() - t0}ms`);
        return zip
          ? new NextResponse(buf, { headers: attachment('application/zip', `vsecc_logs_${safeId}${controller ? `_${controller}` : ''}.zip`) })
          : new NextResponse(buf, { headers: attachment('application/octet-stream', `${safeId}${controller ? `_${controller}` : ''}_${name}`) });
      };
      return (await withStationVsecc(st, stations, work, controller || null)).result;   // chosen vSECC, else .11 / .12 known-first
    }

    // ── Viewer: read the store (pull first on ↻ Refresh or if nothing is stored yet) ──
    let state = await storedState(sid);
    let pulled = false;
    if (fresh) {
      state = await collectStation(st, stations);           // ↻ Refresh: user asked to wait
      pulled = true;
    } else if (!state) {
      // Never collected yet: start in the background and answer now; the panel's auto-refresh picks it up.
      void collectStation(st, stations).catch(() => {});
      state = { controllers: {} };
      // A failed pull is NOT an error response: the page keeps working and shows
      // whatever is stored (possibly nothing yet) plus the status in `collector`.
    }

    const controllers = await storedControllers(sid);
    if (!controllers.some(c => c.key === controller)) controller = controllers[0]?.key || '';
    const ctrl = controller ? state.controllers[controller] : undefined;

    let files: string[] | undefined;
    if (withList || !name) {
      files = controller ? await storedFileNames(sid, controller) : [];
      if (!name) name = pickDefault(files);
    }
    const lines = name && controller ? await storedTail(sid, controller, name, tail) : [];
    // Status of the vSECC being shown; if the whole station failed, that error wins.
    const lastError = state.lastError || ctrl?.lastError || null;
    const total = Date.now() - t0;
    return NextResponse.json({
      ...(files ? { files } : {}),
      name: name || '',
      totalLines: null,
      lines,
      partial: true,
      controllers: controllers.map(c => ({ key: c.key, label: c.label, lastOkAt: c.lastOkAt, offline: !!c.lastError })),
      controller,
      fetchedAt: ctrl?.lastOkAt || null,
      collector: {
        ...collectorStatus(),
        lastRunAt: state.lastRunAt || null,
        lastOkAt: ctrl?.lastOkAt || null,
        // Raw errors can include network IDs / config names — admins only.
        lastError: lastError ? (session.role === 'admin' ? lastError : 'Charger not reachable on the last attempt') : null,
        nextTryAt: state.lastError ? state.nextTryAt || null : null,
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
