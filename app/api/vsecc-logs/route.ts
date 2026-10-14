import { NextRequest, NextResponse } from 'next/server';
import { getMongoClient } from '@/lib/mongoClient';
import { getRequestSession } from '@/lib/authorization';
import { loadStations } from '@/lib/stationRepository';
import { vseccBaseUrl, vseccGet, isSafeLogName, VseccError } from '@/lib/vsecc';
import { isNetworkId, withStationNetwork, ZeroTierError } from '@/lib/zerotier';
import { audit } from '@/lib/audit';
import { canViewStation } from '@/lib/stationAccess';

const MAX_TAIL_LINES = 5000;
/** Bytes fetched from the end of a log for the viewer (enough for 5000 typical lines). */
const TAIL_BYTES     = 1_500_000;
const LIST_TTL_MS    = 60_000;
const FILE_TTL_MS    = 30_000;

// ── Short-lived server cache: changing "last N lines" or re-opening a file
//    within the TTL never goes back to the charger. ↻ Refresh bypasses it.
interface FileEntry { lines: string[]; partial: boolean; bytes: number; at: number }
const g = globalThis as any;
const listCache: Map<string, { files: string[]; at: number }> = g.__vseccListCache ??= new Map();
const fileCache: Map<string, FileEntry> = g.__vseccFileCache ??= new Map();

function pickDefault(files: string[]): string {
  return files.find(f => f.startsWith('charging-manager')) || files[0] || '';
}

/**
 * GET /api/vsecc-logs?stationId=X                          → { files }
 * GET /api/vsecc-logs?stationId=X&withList=1&tail=500      → { files, name, totalLines, lines, partial }  (first open: one round trip)
 * GET /api/vsecc-logs?stationId=X&name=F&tail=500          → { name, totalLines, lines, partial }
 * GET /api/vsecc-logs?stationId=X&name=F&download=1        → raw file (attachment)
 * GET /api/vsecc-logs?stationId=X&zip=1                    → all logs as zip (attachment)
 * Add &fresh=1 to bypass the server cache.
 *
 * Admins: any Vector station. Customers: only their own customer's stations
 * (same rule as every other station API). Read-only — nothing here deletes logs.
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
  const timing = { network: 0, charger: 0, bytes: 0, cached: true };

  try {
    const stations = await loadStations(await getMongoClient());
    const st = stations.find((s: any) => s.id === stationId || s.name === stationId);
    // Out-of-scope stations look exactly like missing ones.
    if (!st || !canViewStation(session, st)) return NextResponse.json({ error: 'Station not found' }, { status: 404 });
    if (st.controllerType !== 'vector') {
      return NextResponse.json({ error: 'Log Manager is only available for Vector stations' }, { status: 400 });
    }
    const base = vseccBaseUrl(st);
    const sid = String(st.id);
    const safeId = sid.replace(/[^\w.\-]/g, '_');
    const zip = url.searchParams.get('zip') === '1';
    const download = url.searchParams.get('download') === '1';
    const withList = url.searchParams.get('withList') === '1';
    const fresh = url.searchParams.get('fresh') === '1';
    const tail = Math.min(Math.max(Number(url.searchParams.get('tail')) || 500, 1), MAX_TAIL_LINES);

    // Audit opening the log viewer and every download (not each filter / line-count change).
    if (zip || download) void audit(session, 'vsecc_log_download', { req, target: sid, details: { file: zip ? '(all, zip)' : name } });
    else if (withList) void audit(session, 'vsecc_log_view', { req, target: sid, details: { fresh } });

    const listKey = sid;
    const fileKey = (n: string) => `${sid}|${n}`;
    const listHit = !fresh && listCache.get(listKey);
    const listFresh = listHit && Date.now() - listHit.at < LIST_TTL_MS ? listHit.files : null;

    // Can this request be answered from cache alone? Then skip ZeroTier + charger entirely.
    if (!zip && !download && !fresh) {
      const files = (withList || !name) ? listFresh : [];
      const want = name || (files ? pickDefault(files) : '');
      const fe = want ? fileCache.get(fileKey(want)) : undefined;
      const feFresh = fe && Date.now() - fe.at < FILE_TTL_MS ? fe : null;
      if (files && !name && !withList) return respond({ files });
      if (files && feFresh) return respond({ ...(withList || !name ? { files } : {}), ...view(want, feFresh) });
    }

    // Everything that talks to the charger runs inside work(); bodies are read
    // fully there so the ZeroTier network isn't switched mid-transfer.
    let tWork = 0;
    const work = async (): Promise<NextResponse> => {
      tWork = Date.now();
      timing.network = tWork - t0;
      timing.cached = false;
      const get = (path: string, timeoutMs: number, headers: Record<string, string> = {}) =>
        vseccGet(base, path, timeoutMs, sid, headers);

      if (zip) {
        const buf = await (await get('/logging/files', 180_000)).arrayBuffer();
        timing.bytes = buf.byteLength;
        return finish(new NextResponse(buf, { headers: attachment('application/zip', `vsecc_logs_${safeId}.zip`) }));
      }

      let files: string[] | null = null;
      if (withList || !name) {
        files = (!fresh && listFresh) || null;
        if (!files) {
          const j = await (await get('/logging/filenames', 15_000)).json();
          files = Array.isArray(j) ? j : [];
          listCache.set(listKey, { files, at: Date.now() });
        }
        if (!name && !withList) return finish(respond({ files }));
        name = pickDefault(files);
        if (!name) return finish(respond({ files, name: '', totalLines: 0, lines: [], partial: false }));
      }

      if (download) {
        const buf = await (await get(`/logging/files/${encodeURIComponent(name!)}`, 120_000)).arrayBuffer();
        timing.bytes = buf.byteLength;
        return finish(new NextResponse(buf, { headers: attachment('application/octet-stream', `${safeId}_${name}`) }));
      }

      const hit = !fresh ? fileCache.get(fileKey(name!)) : undefined;
      let fe = hit && Date.now() - hit.at < FILE_TTL_MS ? hit : null;
      if (!fe) {
        // Ask only for the end of the file; a server that ignores Range sends it all (200).
        const res = await get(`/logging/files/${encodeURIComponent(name!)}`, 60_000, { Range: `bytes=-${TAIL_BYTES}` });
        const text = await res.text();
        const partial = res.status === 206;
        const lines = text.split(/\r?\n/);
        if (lines.length && lines[lines.length - 1] === '') lines.pop();
        if (partial && lines.length) lines.shift();          // first line is cut mid-way
        fe = { lines: lines.slice(-MAX_TAIL_LINES), partial, bytes: Buffer.byteLength(text), at: Date.now() };
        fileCache.set(fileKey(name!), fe);
        timing.bytes = fe.bytes;
      }
      return finish(respond({ ...(files ? { files } : {}), ...view(name!, fe) }));
    };

    function view(n: string, fe: FileEntry) {
      return {
        name: n,
        totalLines: fe.partial ? null : fe.lines.length,
        lines: fe.lines.slice(-tail),
        partial: fe.partial,
        fetchedAt: new Date(fe.at).toISOString(),
      };
    }
    function respond(body: any) {
      if (!timing.cached && tWork) timing.charger = Date.now() - tWork;
      const total = Date.now() - t0;
      return NextResponse.json({ ...body, timing: { ...timing, totalMs: total } }, {
        headers: { 'Cache-Control': 'private, no-store', 'Server-Timing': serverTiming(total) },
      });
    }
    function finish(res: NextResponse) {
      if (!timing.charger) timing.charger = Date.now() - tWork;
      const total = Date.now() - t0;
      console.log(`[api/vsecc-logs] ${sid} ${zip ? 'zip' : download ? `download ${name}` : name || 'list'} ` +
        `network=${timing.network}ms charger=${timing.charger}ms bytes=${timing.bytes} total=${total}ms`);
      res.headers.set('Server-Timing', serverTiming(total));
      return res;
    }
    function serverTiming(total: number) {
      return `zt;dur=${timing.network}, vsecc;dur=${timing.charger}, total;dur=${total}`;
    }
    function attachment(type: string, filename: string): Record<string, string> {
      return { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'private, no-store' };
    }

    // Station field holds a ZeroTier network ID and no explicit URL override →
    // switch this server onto that station's network first.
    if (!st.vseccApiUrl && isNetworkId(st.zerotierIp)) {
      const stationNetworks = stations.map((s: any) => s.zerotierIp).filter(isNetworkId);
      return await withStationNetwork(st.zerotierIp.trim(), stationNetworks, work);
    }
    return await work();
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
