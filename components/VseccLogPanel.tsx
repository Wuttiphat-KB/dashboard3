'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSessionAccess } from '@/components/SessionProvider';

interface Props {
  stationId: string;
}

interface LogView {
  name: string;
  totalLines: number | null;   // null when only the end of the file was fetched
  lines: string[];
  partial?: boolean;
  timing?: { network: number; charger: number; bytes: number; cached: boolean; totalMs: number };
  fetchedAt?: string | null;
  controllers?: { key: string; label: string; lastOkAt: string | null; offline: boolean }[];
  controller?: string;
  collector?: {
    running: boolean; intervalSec: number; retentionDays: number; stations: number; offline?: number; lastCycleMs: number | null;
    lastRunAt: string | null; lastOkAt: string | null; lastError: string | null; nextTryAt?: string | null;
  };
}

function ago(iso: string | null | undefined, now: number): string {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s ago`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
}

const TAIL_OPTIONS = [200, 500, 1000, 5000];

function levelColor(line: string): string | undefined {
  if (/\b(ERROR|ERR|FATAL|CRIT(ICAL)?)\b/i.test(line)) return 'var(--error-text)';
  if (/\bWARN(ING)?\b/i.test(line)) return 'var(--warn-text)';
  return undefined;
}

async function apiJson(url: string) {
  const r = await fetch(url, { cache: 'no-store' });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j;
}

export default function VseccLogPanel({ stationId }: Props) {
  const { isAdmin } = useSessionAccess();
  // Cabinets with two vSECCs (.11 and .12): which one to show ('' = server default, the first).
  const [reqCtrl, setReqCtrl] = useState('');
  const base = `/api/vsecc-logs?stationId=${encodeURIComponent(stationId)}${reqCtrl ? `&controller=${encodeURIComponent(reqCtrl)}` : ''}`;

  const [files, setFiles] = useState<string[] | null>(null);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>('');
  const [tail, setTail] = useState(500);
  const [view, setView] = useState<LogView | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewError, setViewError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // First open (and ↻ Refresh): list + default file in ONE request.
  // Changing file / line count afterwards hits the server cache (fast).
  const [fresh, setFresh] = useState(false);
  const loadedFor = useRef<string>('');

  useEffect(() => {
    let cancelled = false;
    setFilesError(null);
    setViewLoading(true);
    setViewError(null);
    apiJson(`${base}&withList=1&tail=${tail}${fresh ? '&fresh=1' : ''}`)
      .then(j => {
        if (cancelled) return;
        setFiles(j.files || []);
        setFilesError(null);
        loadedFor.current = `${j.name}|${tail}`;
        setSelected(j.name || '');
        setView(j);
      })
      .catch(err => { if (!cancelled) { setFilesError(err.message); setFiles(prev => prev ?? []); } })
      .finally(() => { if (!cancelled) { setViewLoading(false); setFresh(false); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, reloadKey]);

  // Another file or line count chosen.
  useEffect(() => {
    if (!selected || !files) return;
    const key = `${selected}|${tail}`;
    if (loadedFor.current === key) return;
    let cancelled = false;
    setViewLoading(true);
    setViewError(null);
    apiJson(`${base}&name=${encodeURIComponent(selected)}&tail=${tail}`)
      .then(j => { if (!cancelled) { loadedFor.current = key; setView(j); } })
      .catch(err => { if (!cancelled) { setViewError(err.message); setView(null); } })
      .finally(() => { if (!cancelled) setViewLoading(false); });
    return () => { cancelled = true; };
  }, [base, selected, tail, files]);

  const refresh = () => { setFresh(true); setReloadKey(k => k + 1); };

  // Downloads go through fetch so a failure shows a message here instead of a raw JSON page.
  const [dl, setDl] = useState<{ busy: string | null; error: string | null }>({ busy: null, error: null });
  const [dlStarted, setDlStarted] = useState(0);
  const download = async (key: string, url: string, fallbackName: string) => {
    setDl({ busy: key, error: null });
    setDlStarted(Date.now());
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        throw new Error(j?.error || `HTTP ${r.status}`);
      }
      const blob = await r.blob();
      const m = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = m?.[1] || fallbackName;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      setDl({ busy: null, error: null });
    } catch (err: any) {
      setDl({ busy: null, error: err?.message || 'Download failed' });
    }
  };

  // Auto-refresh: re-read the server's stored copy (collected in the background) — cheap, no charger round trip.
  const [auto, setAuto] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const preRef = useRef<HTMLPreElement>(null);
  const stickBottom = useRef(true);
  const pollSec = Math.max(10, view?.collector?.intervalSec || 30);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!auto || !files) return;
    let cancelled = false;
    const t = setInterval(() => {
      if (document.hidden) return;
      apiJson(`${base}${selected ? `&name=${encodeURIComponent(selected)}` : ''}&tail=${tail}`)
        .then(j => {
          if (cancelled) return;
          if (!selected) {                    // nothing collected yet → adopt the first log once it appears
            if (j.files?.length) { setFiles(j.files); loadedFor.current = `${j.name}|${tail}`; setSelected(j.name); }
            setView(j);
          } else if (loadedFor.current === `${selected}|${tail}`) setView(j);
        })
        .catch(() => { /* keep showing the last good view */ });
    }, pollSec * 1000);
    return () => { cancelled = true; clearInterval(t); };
  }, [auto, base, selected, tail, files, pollSec]);
  // Keep the view pinned to the newest line unless the user scrolled up.
  useEffect(() => {
    const el = preRef.current;
    if (el && stickBottom.current) el.scrollTop = el.scrollHeight;
  }, [view]);

  // Seconds counter shown next to the spinner while a request is in flight.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!viewLoading) return;
    setElapsed(0);
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500);
    return () => clearInterval(t);
  }, [viewLoading]);

  const shown = useMemo(() => {
    if (!view) return [];
    const q = filter.trim().toLowerCase();
    return view.lines.filter(l =>
      (!q || l.toLowerCase().includes(q)) && (!onlyProblems || levelColor(l)));
  }, [view, filter, onlyProblems]);

  const label = { fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.05em' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Controls */}
      <div className="card" style={{ padding: '0.875rem 1rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={label}>Log file</label>
            <select className="input" value={selected} onChange={e => setSelected(e.target.value)}
              disabled={!files} style={{ padding: '4px 8px', fontSize: 11, minWidth: 220 }}>
              {!files && <option>⏳ Loading...</option>}
              {files?.length === 0 && <option value="">No log files</option>}
              {files?.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>

          {(view?.controllers?.length ?? 0) > 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={label}>vSECC</label>
              <select className="input" value={view?.controller || ''} onChange={e => setReqCtrl(e.target.value)}
                style={{ padding: '4px 8px', fontSize: 11 }}>
                {view!.controllers!.map(c => (
                  <option key={c.key} value={c.key}>{c.label}{c.offline ? ' (offline)' : ''}</option>
                ))}
              </select>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={label}>Last lines</label>
            <select className="input" value={tail} onChange={e => setTail(Number(e.target.value))}
              style={{ padding: '4px 8px', fontSize: 11 }}>
              {TAIL_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 160 }}>
            <label style={label}>Filter</label>
            <input className="input" value={filter} onChange={e => setFilter(e.target.value)}
              placeholder="Search text..." style={{ padding: '4px 8px', fontSize: 11 }} />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)', paddingBottom: 6 }}>
            <input type="checkbox" checked={onlyProblems} onChange={e => setOnlyProblems(e.target.checked)} />
            Errors / warnings only
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)', paddingBottom: 6 }}
            title="Re-read the log the server collects in the background">
            <input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} />
            Auto {pollSec}s
          </label>

          <button className="btn btn-secondary" style={{ padding: '5px 12px', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 6 }}
            onClick={refresh} disabled={viewLoading} title="Pull new lines from the charger now">
            {viewLoading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : '↻'} Refresh
          </button>
          {([
            ['stored', '⬇ Stored', `${base}&name=${encodeURIComponent(selected)}&stored=1`, `${selected}_stored.log`, !!selected,
              `Everything stored on the server for this log (last ${view?.collector?.retentionDays ?? 7} days) — works even when the charger is offline`],
            ['live', '⬇ Live file', `${base}&name=${encodeURIComponent(selected)}&download=1`, selected, !!selected, 'Current file straight from the charger'],
            ['zip', '⬇ All logs (zip)', `${base}&zip=1`, 'vsecc_logs.zip', true,
              `Every log stored on the server (last ${view?.collector?.retentionDays ?? 7} days${(view?.controllers?.length ?? 0) > 1 ? ', both vSECCs' : ''}) — works even when the charger is offline`],
            ['livezip', '⬇ Live zip', `${base}&zip=1&live=1`, 'vsecc_logs_live.zip', true, 'All log files straight from the charger (slow: goes over ZeroTier)'],
          ] as const).map(([key, text, url0, name, enabled, title]) => {
            const url = !reqCtrl && view?.controller ? `${url0}&controller=${encodeURIComponent(view.controller)}` : url0;
            return (
            <button key={key} className={key === 'zip' ? 'btn btn-primary' : 'btn btn-secondary'} title={title}
              style={{ padding: '5px 12px', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 6 }}
              disabled={!enabled || !!dl.busy} onClick={() => download(key, url, name)}>
              {dl.busy === key && <span className="spinner" style={{ width: 12, height: 12 }} />}{text}
            </button>
            );
          })}
        </div>
        {dl.busy && (
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="spinner" style={{ width: 12, height: 12 }} />
            Preparing download… {Math.max(0, Math.round((now - dlStarted) / 1000))}s
            {(dl.busy === 'live' || dl.busy === 'livezip') && ' — fetching from the charger over ZeroTier, this can take a minute or two'}
          </div>
        )}
        {dl.error && (
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--warn-text)' }}>
            ⚠ Download failed: {dl.error}
            {' '}<span style={{ color: 'var(--text-muted)' }}>— the charger may be offline; ⬇ Stored still works.</span>
            <button className="btn btn-secondary" style={{ marginLeft: 8, padding: '1px 8px', fontSize: 10 }} onClick={() => setDl({ busy: null, error: null })}>✕</button>
          </div>
        )}
        {filesError && (
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--warn-text)' }}>
            ⚠ {filesError}
            {!isAdmin && ' — please try again later.'}
          </div>
        )}
        {view?.collector && (
          <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-muted)', display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <span title={view.collector.lastOkAt ? new Date(view.collector.lastOkAt).toLocaleString() : ''}>
              ● Collected {ago(view.collector.lastOkAt, now)}
            </span>
            {view.collector.running && view.collector.lastCycleMs != null && (
              <span>every ~{Math.max(view.collector.intervalSec, Math.round(view.collector.lastCycleMs / 1000))}s
                {view.collector.stations > 1 ? ` (${view.collector.stations} Vector stations in rotation${view.collector.offline ? `, ${view.collector.offline} offline` : ''})` : ''}</span>
            )}
            {view.controller && <span>vSECC {view.controller}{(view.controllers?.length ?? 0) > 1 ? ` · ${view.controllers!.length} vSECCs in this cabinet` : ''}</span>}
            {!view.collector.running && <span>background collector is off — showing what was stored</span>}
            {view.collector.lastError && (
              <span style={{ color: 'var(--warn-text)' }}>
                ⚠ Cannot reach charger — last attempt {ago(view.collector.lastRunAt, now)}: {view.collector.lastError}
                {view.collector.nextTryAt && new Date(view.collector.nextTryAt).getTime() > now
                  ? ` — next automatic try in ${Math.ceil((new Date(view.collector.nextTryAt).getTime() - now) / 60_000)} min (↻ Refresh to try now)` : ''}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">{selected || 'Log'}</span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            {viewLoading && <><span className="spinner" style={{ width: 12, height: 12, marginRight: 6 }} />loading {elapsed}s{view ? ' · ' : ''}</>}
            {view ? `showing ${shown.length} of last ${view.lines.length}${view.totalLines != null ? ` / ${view.totalLines}` : ''} lines` : ''}
            {view?.timing && (
              <span title={`ZeroTier ${view.timing.network} ms · charger ${view.timing.charger} ms · ${Math.round(view.timing.bytes / 1024)} KB`}>
                {' · '}{view.timing.cached ? 'cached' : `${(view.timing.totalMs / 1000).toFixed(1)} s`}
              </span>
            )}
          </span>
        </div>
        {viewError && <div style={{ padding: '1rem', color: 'var(--error-text)', fontSize: 12 }}>{viewError}</div>}
        {viewLoading && !view && (
          <div style={{ padding: '2.5rem 1rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: 'var(--text-muted)', fontSize: 12 }}>
            <span className="spinner spinner-lg" />
            <div>Loading log... {elapsed}s</div>
            {elapsed >= 3 && (
              <div style={{ fontSize: 11 }}>Connecting to the charger over ZeroTier — first load or switching station can take 10–30 s</div>
            )}
          </div>
        )}
        {view && (
          <div style={{ position: 'relative' }}>
          {viewLoading && (
            <div style={{
              position: 'absolute', inset: 0, zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 10, fontSize: 12, color: 'var(--text-secondary)', pointerEvents: 'none',
            }}>
              <span className="spinner spinner-lg" /> {elapsed}s
            </div>
          )}
          <pre ref={preRef}
            onScroll={e => { const el = e.currentTarget; stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}
            style={{
            margin: 0, padding: '0.75rem 1rem', maxHeight: 600, overflow: 'auto',
            fontSize: 11, lineHeight: 1.5, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)', opacity: viewLoading ? 0.6 : 1,
          }}>
            {view.lines.length === 0
              ? <span style={{ color: 'var(--text-muted)' }}>
 {!view.collector?.lastRunAt
                    ? 'Collecting this station for the first time — lines appear here automatically.'
                    : view.collector?.lastError
                    ? 'No log stored for this station yet — the charger has not been reachable. It will be collected automatically once it is back online.'
                    : 'No log lines yet.'}
                </span>
              : shown.length === 0
              ? <span style={{ color: 'var(--text-muted)' }}>No matching lines</span>
              : shown.map((l, i) => <div key={i} style={{ color: levelColor(l) || 'var(--text-secondary)' }}>{l}</div>)}
          </pre>
          </div>
        )}
      </div>
    </div>
  );
}
