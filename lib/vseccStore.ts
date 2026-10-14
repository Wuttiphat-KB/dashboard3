/**
 * vSECC Manager Log collector + on-disk store (server-side only).
 *
 * A background loop (started from instrumentation.ts) walks every Vector
 * station, pulls only the NEW bytes of each vSECC log file (HTTP Range) and
 * appends them to a per-day file on disk:
 *
 *   <VSECC_LOG_DIR>/<stationId>/<YYYY-MM-DD>/<logname>     appended lines
 *   <VSECC_LOG_DIR>/<stationId>/_state.json                 offsets + status
 *
 * The Manager Log tab then reads from disk, so it opens instantly.
 *
 * Stations behind a ZeroTier *network ID* share one LAN address, so the server
 * can only be on one of them at a time (lib/zerotier.ts). The loop therefore
 * visits stations one by one; each station is refreshed every
 * max(VSECC_COLLECT_INTERVAL_SEC, time to visit all stations).
 *
 * .env.local:
 *   VSECC_COLLECTOR=0               disable the background loop (default: on when VSECC_USERNAME is set)
 *   VSECC_COLLECT_INTERVAL_SEC=30   minimum time between two visits of the same station
 *   VSECC_LOG_DIR=…                 default <project>/data/vsecc-logs
 *   VSECC_LOG_RETENTION_DAYS=7      day folders older than this are deleted
 *   VSECC_COLLECT_FILES=<regex>     only collect log names matching this (default: all)
 */

import { promises as fs, createReadStream } from 'fs';
import path from 'path';
import { getMongoClient } from './mongoClient';
import { loadStations } from './stationRepository';
import { vseccBaseUrl, vseccGet, vseccConfigured, isSafeLogName } from './vsecc';
import { isNetworkId, withStationNetwork } from './zerotier';

const SEED_BYTES   = 1_500_000;   // first contact / after rotation: keep only the end of the file
const MAX_CHUNK    = 5_000_000;   // catch-up per visit; the rest comes on the next visit
const OVERLAP      = 256;         // bytes re-read before the offset to detect rotation
const READ_BYTES   = 1_500_000;   // per day-file, when building the viewer tail

const intervalMs  = () => Math.max(5, Number(process.env.VSECC_COLLECT_INTERVAL_SEC) || 30) * 1000;
const retentionDays = () => Math.max(1, Number(process.env.VSECC_LOG_RETENTION_DAYS) || 7);

export function logRoot(): string {
  return process.env.VSECC_LOG_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), 'data', 'vsecc-logs');
}
export const safeStationId = (id: string) => String(id).replace(/[^\w.\-]/g, '_');
const stationDir = (id: string) => path.join(logRoot(), safeStationId(id));
const isDayDir = (n: string) => /^\d{4}-\d{2}-\d{2}$/.test(n);

function today(): string {
  const d = new Date();   // server local time (Asia/Bangkok on the dashboard host)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── State ────────────────────────────────────────────────────────────────
interface FileState { offset: number; tail: string /* base64 of bytes just before offset */ }
export interface StationState {
  files: Record<string, FileState>;
  remoteFiles?: string[];
  lastRunAt?: string;
  lastOkAt?: string;
  lastError?: string | null;
  lastDurationMs?: number;
}

async function readState(id: string): Promise<StationState | null> {
  try { return JSON.parse(await fs.readFile(path.join(stationDir(id), '_state.json'), 'utf8')); }
  catch { return null; }
}
async function writeState(id: string, st: StationState): Promise<void> {
  const dir = stationDir(id);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, '_state.json.tmp');
  await fs.writeFile(tmp, JSON.stringify(st, null, 1));
  await fs.rename(tmp, path.join(dir, '_state.json'));
}

// ── Pull one file ────────────────────────────────────────────────────────
type Getter = (p: string, timeoutMs: number, headers: Record<string, string>, accept: number[]) => Promise<Response>;

function contentRangeStart(res: Response): number {
  const m = /bytes\s+(\d+)-/i.exec(res.headers.get('content-range') || '');
  return m ? Number(m[1]) : 0;
}

/** Returns the new state for the file and how many bytes were stored. */
async function pullFile(get: Getter, id: string, name: string, prev: FileState | undefined): Promise<{ st: FileState; stored: number }> {
  const p = `/logging/files/${encodeURIComponent(name)}`;
  let data: Buffer;            // bytes to consider storing
  let dataStart: number;       // remote offset of data[0]
  let oldTail = Buffer.alloc(0);
  let seeded = false;          // data may start mid-line

  const seed = async () => {
    const res = await get(p, 60_000, { Range: `bytes=-${SEED_BYTES}` }, [206, 416]);
    if (res.status === 416) { data = Buffer.alloc(0); dataStart = 0; return; }
    const buf = Buffer.from(await res.arrayBuffer());
    if (res.status === 206) { data = buf; dataStart = contentRangeStart(res); }
    else { data = buf.subarray(Math.max(0, buf.length - SEED_BYTES)); dataStart = buf.length - data.length; }
    seeded = dataStart > 0;
    oldTail = Buffer.alloc(0);
  };

  if (!prev) {
    await seed();
  } else {
    oldTail = Buffer.from(prev.tail || '', 'base64');
    const from = prev.offset - oldTail.length;
    const res = await get(p, 60_000, { Range: `bytes=${from}-${prev.offset + MAX_CHUNK - 1}` }, [206, 416]);
    if (res.status === 416) {
      await seed();                                   // remote file is shorter → rotated
    } else {
      const buf = Buffer.from(await res.arrayBuffer());
      const at = res.status === 206 ? contentRangeStart(res) : 0;
      const tailPos = from - at;                      // where our known tail should sit in buf
      if (tailPos >= 0 && buf.length >= tailPos + oldTail.length
          && buf.subarray(tailPos, tailPos + oldTail.length).equals(oldTail)) {
        const s = tailPos + oldTail.length;
        data = buf.subarray(s, res.status === 206 ? undefined : s + MAX_CHUNK);
        dataStart = prev.offset;
      } else {
        await seed();                                 // content changed under us → rotated
      }
    }
  }

  data = data!; dataStart = dataStart!;
  if (seeded) {                                       // drop the cut first line
    const nl = data.indexOf(10);
    const cut = nl < 0 ? data.length : nl + 1;
    data = data.subarray(cut); dataStart += cut;
  }
  // Store complete lines only; a half-written last line is picked up next visit.
  const last = data.lastIndexOf(10);
  const commit = last < 0 ? Buffer.alloc(0) : data.subarray(0, last + 1);
  if (commit.length) {
    const dir = path.join(stationDir(id), today());
    await fs.mkdir(dir, { recursive: true });
    await fs.appendFile(path.join(dir, name), commit);
  }
  const tail = Buffer.concat([oldTail, commit]);
  return {
    st: { offset: dataStart + commit.length, tail: tail.subarray(Math.max(0, tail.length - OVERLAP)).toString('base64') },
    stored: commit.length,
  };
}

// ── Pull one station ─────────────────────────────────────────────────────
const g = globalThis as any;
const inFlight: Map<string, Promise<StationState>> = g.__vseccCollectInFlight ??= new Map();

function fileFilter(): (n: string) => boolean {
  const raw = process.env.VSECC_COLLECT_FILES;
  if (!raw) return () => true;
  try { const re = new RegExp(raw); return n => re.test(n); } catch { return () => true; }
}

/**
 * Pull new log bytes for one station now. Concurrent calls for the same
 * station share one run. `allStations` is needed to know which ZeroTier
 * networks belong to stations (only those are left when switching).
 */
export function collectStation(st: any, allStations: any[]): Promise<StationState> {
  const id = String(st.id);
  const running = inFlight.get(id);
  if (running) return running;
  const run = (async () => {
    const state: StationState = (await readState(id)) || { files: {} };
    const t0 = Date.now();
    state.lastRunAt = new Date().toISOString();
    try {
      const base = vseccBaseUrl(st);
      const work = async () => {
        const get: Getter = (p, ms, h, accept) => vseccGet(base, p, ms, id, h, accept);
        const list = await (await get('/logging/filenames', 15_000, {}, [])).json();
        const want = fileFilter();
        const files: string[] = (Array.isArray(list) ? list : []).filter((n: any) => typeof n === 'string' && isSafeLogName(n));
        state.remoteFiles = files;
        let stored = 0;
        for (const name of files.filter(want)) {
          const r = await pullFile(get, id, name, state.files[name]);
          state.files[name] = r.st;
          stored += r.stored;
        }
        return stored;
      };
      const stored = !st.vseccApiUrl && isNetworkId(st.zerotierIp)
        ? await withStationNetwork(st.zerotierIp.trim(), allStations.map((s: any) => s.zerotierIp).filter(isNetworkId), work)
        : await work();
      state.lastOkAt = new Date().toISOString();
      state.lastError = null;
      if (stored) console.log(`[vsecc-collector] ${id}: +${Math.round(stored / 1024)} KB in ${Date.now() - t0} ms`);
    } catch (err: any) {
      state.lastError = err?.message || String(err);
      console.warn(`[vsecc-collector] ${id}: ${state.lastError}`);
    }
    state.lastDurationMs = Date.now() - t0;
    await writeState(id, state).catch(err => console.warn(`[vsecc-collector] cannot write state for ${id}:`, err?.message));
    return state;
  })().finally(() => inFlight.delete(id));
  inFlight.set(id, run);
  return run;
}

// ── Background loop ──────────────────────────────────────────────────────
interface LoopStatus { running: boolean; stations: number; lastCycleMs: number | null; cycleStartedAt: string | null; current: string | null }
const loopStatus: LoopStatus = g.__vseccLoopStatus ??= { running: false, stations: 0, lastCycleMs: null, cycleStartedAt: null, current: null };

export function collectorStatus(): LoopStatus & { intervalSec: number; retentionDays: number } {
  return { ...loopStatus, intervalSec: intervalMs() / 1000, retentionDays: retentionDays() };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function startVseccCollector(): void {
  if (g.__vseccCollectorStarted) return;
  g.__vseccCollectorStarted = true;
  if (process.env.VSECC_COLLECTOR === '0') { console.log('[vsecc-collector] disabled (VSECC_COLLECTOR=0)'); return; }
  if (!vseccConfigured()) { console.log('[vsecc-collector] not started — VSECC_USERNAME / VSECC_PASSWORD not set'); return; }
  console.log(`[vsecc-collector] started → ${logRoot()} (every ${intervalMs() / 1000}s, keep ${retentionDays()} days)`);
  loopStatus.running = true;
  void (async () => {
    await sleep(5_000);                     // let the server finish starting
    let lastPrune = 0;
    for (;;) {
      const t0 = Date.now();
      loopStatus.cycleStartedAt = new Date(t0).toISOString();
      try {
        const all = await loadStations(await getMongoClient());
        const vector = all.filter((s: any) => s.controllerType === 'vector' && (s.vseccApiUrl || s.zerotierIp));
        loopStatus.stations = vector.length;
        for (const st of vector) {
          loopStatus.current = String(st.id);
          await collectStation(st, all).catch(() => {});
        }
      } catch (err: any) {
        console.warn('[vsecc-collector] cycle failed:', err?.message || err);
      }
      loopStatus.current = null;
      loopStatus.lastCycleMs = Date.now() - t0;
      if (Date.now() - lastPrune > 3600_000) { lastPrune = Date.now(); await pruneOld().catch(() => {}); }
      await sleep(Math.max(2_000, intervalMs() - (Date.now() - t0)));
    }
  })();
}

/** Delete day folders older than the retention period. */
export async function pruneOld(): Promise<void> {
  const keep = new Date();
  keep.setDate(keep.getDate() - retentionDays() + 1);
  const cutoff = `${keep.getFullYear()}-${String(keep.getMonth() + 1).padStart(2, '0')}-${String(keep.getDate()).padStart(2, '0')}`;
  const stations = await fs.readdir(logRoot()).catch(() => [] as string[]);
  for (const s of stations) {
    const days = await fs.readdir(path.join(logRoot(), s)).catch(() => [] as string[]);
    for (const d of days) {
      if (isDayDir(d) && d < cutoff) {
        await fs.rm(path.join(logRoot(), s, d), { recursive: true, force: true });
        console.log(`[vsecc-collector] pruned ${s}/${d}`);
      }
    }
  }
}

// ── Reading for the viewer ───────────────────────────────────────────────
export async function storedState(id: string): Promise<StationState | null> {
  return readState(id);
}

async function dayDirs(id: string): Promise<string[]> {
  return (await fs.readdir(stationDir(id)).catch(() => [] as string[])).filter(isDayDir).sort();
}

/** Log names known for a station: what the charger listed last time + what is on disk. */
export async function storedFileNames(id: string): Promise<string[]> {
  const names = new Set<string>((await readState(id))?.remoteFiles || []);
  for (const d of await dayDirs(id)) {
    for (const f of await fs.readdir(path.join(stationDir(id), d)).catch(() => [] as string[])) names.add(f);
  }
  return [...names].filter(isSafeLogName).sort();
}

async function lastLinesOf(file: string, maxBytes: number): Promise<string[]> {
  let fh;
  try { fh = await fs.open(file, 'r'); } catch { return []; }
  try {
    const { size } = await fh.stat();
    const len = Math.min(size, maxBytes);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, size - len);
    const lines = buf.toString('utf8').split(/\r?\n/);
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    if (len < size && lines.length) lines.shift();
    return lines;
  } finally { await fh.close(); }
}

/** Last `n` stored lines of a log, walking back through the day folders. */
export async function storedTail(id: string, name: string, n: number): Promise<string[]> {
  if (!isSafeLogName(name)) return [];
  let out: string[] = [];
  for (const d of (await dayDirs(id)).reverse()) {
    const lines = await lastLinesOf(path.join(stationDir(id), d, name), READ_BYTES);
    out = lines.concat(out);
    if (out.length >= n) break;
  }
  return out.slice(-n);
}

/** Every stored day of one log, oldest first, as one stream (for download). */
export async function storedStream(id: string, name: string): Promise<ReadableStream<Uint8Array> | null> {
  if (!isSafeLogName(name)) return null;
  const files: string[] = [];
  for (const d of await dayDirs(id)) {
    const f = path.join(stationDir(id), d, name);
    if (await fs.stat(f).then(s => s.isFile()).catch(() => false)) files.push(f);
  }
  if (!files.length) return null;
  return new ReadableStream<Uint8Array>({
    async start(ctrl) {
      try {
        for (const f of files) for await (const chunk of createReadStream(f)) ctrl.enqueue(new Uint8Array(chunk as Buffer));
        ctrl.close();
      } catch (err) { ctrl.error(err); }
    },
  });
}
