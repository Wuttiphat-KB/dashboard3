'use client';

import { useEffect, useMemo, useState } from 'react';

interface Props {
  stationId: string;
}

interface LogView {
  name: string;
  totalLines: number;
  lines: string[];
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

  // File list
  useEffect(() => {
    let cancelled = false;
    setFiles(null);
    setFilesError(null);
    apiJson(base)
      .then(j => {
        if (cancelled) return;
        const list: string[] = j.files || [];
        setFiles(list);
        setSelected(prev => prev && list.includes(prev) ? prev
          : list.find(f => f.startsWith('charging-manager')) || list[0] || '');
      })
      .catch(err => { if (!cancelled) setFilesError(err.message); });
    return () => { cancelled = true; };
  }, [base, reloadKey]);

  // Selected file content
  useEffect(() => {
    if (!selected) { setView(null); return; }
    let cancelled = false;
    setViewLoading(true);
    setViewError(null);
    apiJson(`${base}&name=${encodeURIComponent(selected)}&tail=${tail}`)
      .then(j => { if (!cancelled) setView(j); })
      .catch(err => { if (!cancelled) { setViewError(err.message); setView(null); } })
      .finally(() => { if (!cancelled) setViewLoading(false); });
    return () => { cancelled = true; };
  }, [base, selected, tail, reloadKey]);

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
        <button className="btn btn-secondary" style={{ marginTop: 10, fontSize: 11 }} onClick={() => setReloadKey(k => k + 1)}>↻ Retry</button>
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
              {!files && <option>Loading...</option>}
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

          <button className="btn btn-secondary" style={{ padding: '5px 12px', fontSize: 11 }}
            onClick={() => setReloadKey(k => k + 1)}>↻ Refresh</button>
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
            {view ? `showing ${shown.length} of last ${view.lines.length} / ${view.totalLines} lines` : ''}
          </span>
        </div>
        {viewError && <div style={{ padding: '1rem', color: 'var(--error-text)', fontSize: 12 }}>{viewError}</div>}
        {viewLoading && !view && <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading log...</div>}
        {view && (
          <pre style={{
            margin: 0, padding: '0.75rem 1rem', maxHeight: 600, overflow: 'auto',
            fontSize: 11, lineHeight: 1.5, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)', opacity: viewLoading ? 0.6 : 1,
          }}>
            {shown.length === 0
              ? <span style={{ color: 'var(--text-muted)' }}>No matching lines</span>
              : shown.map((l, i) => <div key={i} style={{ color: levelColor(l) || 'var(--text-secondary)' }}>{l}</div>)}
          </pre>
        )}
      </div>
    </div>
  );
}
