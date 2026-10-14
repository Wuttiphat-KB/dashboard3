'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

interface Props {
  stationId: string;
}

interface LogView {
  name: string;
  totalLines: number | null;   // null when only the end of the file was fetched
  lines: string[];
  partial?: boolean;
  timing?: { network: number; charger: number; bytes: number; cached: boolean; totalMs: number };
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
  const base = `/api/vsecc-logs?stationId=${encodeURIComponent(stationId)}`;

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
    setFiles(null);
    setFilesError(null);
    setViewLoading(true);
    setViewError(null);
    apiJson(`${base}&withList=1&tail=${tail}${fresh ? '&fresh=1' : ''}`)
      .then(j => {
        if (cancelled) return;
        setFiles(j.files || []);
        loadedFor.current = `${j.name}|${tail}`;
        setSelected(j.name || '');
        setView(j.name ? j : null);
      })
      .catch(err => { if (!cancelled) setFilesError(err.message); })
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

  if (filesError) {
    return (
      <div className="card" style={{ padding: '1rem', borderColor: 'var(--error)' }}>
        <div style={{ color: 'var(--error-text)', fontWeight: 600, marginBottom: 6 }}>
          {filesError.startsWith('Route conflict') ? '⚠ ZeroTier route conflict — logs could come from the wrong charger' : 'Cannot load vSECC log list'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{filesError}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
          Check VSECC_USERNAME / VSECC_PASSWORD / VSECC_URL_TEMPLATE in .env.local and that this server can reach the charger.
        </div>
        <button className="btn btn-secondary" style={{ marginTop: 10, fontSize: 11 }} onClick={refresh}>↻ Retry</button>
      </div>
    );
  }

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

          <button className="btn btn-secondary" style={{ padding: '5px 12px', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 6 }}
            onClick={refresh} disabled={viewLoading}>
            {viewLoading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : '↻'} Refresh
          </button>
          <a className="btn btn-secondary" style={{ padding: '5px 12px', fontSize: 11, textDecoration: 'none', opacity: selected ? 1 : 0.5, pointerEvents: selected ? 'auto' : 'none' }}
            href={`${base}&name=${encodeURIComponent(selected)}&download=1`}>⬇ File</a>
          <a className="btn btn-primary" style={{ padding: '5px 12px', fontSize: 11, textDecoration: 'none' }}
            href={`${base}&zip=1`}>⬇ All logs (zip)</a>
        </div>
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
          <pre style={{
            margin: 0, padding: '0.75rem 1rem', maxHeight: 600, overflow: 'auto',
            fontSize: 11, lineHeight: 1.5, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)', opacity: viewLoading ? 0.6 : 1,
          }}>
            {shown.length === 0
              ? <span style={{ color: 'var(--text-muted)' }}>No matching lines</span>
              : shown.map((l, i) => <div key={i} style={{ color: levelColor(l) || 'var(--text-secondary)' }}>{l}</div>)}
          </pre>
          </div>
        )}
      </div>
    </div>
  );
}
