'use client';

import { useEffect, useState } from 'react';
import { useSessionAccess } from '@/components/SessionProvider';

interface Row {
  at: string;
  username: string;
  role?: string;
  customer?: string;
  action: string;
  target?: string;
  details?: Record<string, unknown>;
  ip?: string;
  ok?: boolean;
}

const ACTIONS: { id: string; label: string }[] = [
  { id: '',                   label: 'All actions' },
  { id: 'login',              label: 'Login' },
  { id: 'login_failed',       label: 'Login failed' },
  { id: 'logout',             label: 'Logout' },
  { id: 'user_create',        label: 'User created' },
  { id: 'user_update',        label: 'User updated' },
  { id: 'user_delete',        label: 'User deleted' },
  { id: 'customer_create',    label: 'Customer added' },
  { id: 'customer_delete',    label: 'Customer removed' },
  { id: 'station_save',       label: 'Station saved' },
  { id: 'station_delete',     label: 'Station deleted' },
  { id: 'alert_ack',          label: 'Alert acknowledged' },
  { id: 'energy_export',      label: 'Energy export' },
  { id: 'vsecc_log_view',     label: 'vSECC log viewed' },
  { id: 'vsecc_log_download', label: 'vSECC log downloaded' },
];
const actionLabel = (id: string) => ACTIONS.find(a => a.id === id)?.label || id;
const PAGE_SIZE = 100;

function ictDay(offsetDays = 0) {
  const d = new Date(Date.now() + 7 * 3_600_000);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function fmtTime(v: string) {
  const d = new Date(v);
  return isNaN(d.getTime()) ? v : d.toLocaleString('en-GB', { timeZone: 'Asia/Bangkok', hour12: false });
}

function fmtDetails(d?: Record<string, unknown>) {
  if (!d) return '';
  return Object.entries(d).map(([k, v]) => {
    if (v && typeof v === 'object' && 'from' in (v as any)) return `${k}: ${(v as any).from ?? '—'} → ${(v as any).to ?? '—'}`;
    return `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`;
  }).join(' · ');
}

export default function AuditPage() {
  const { isAdmin, loading: sessionLoading } = useSessionAccess();
  const [from, setFrom] = useState(ictDay(-6));
  const [to, setTo] = useState(ictDay(0));
  const [username, setUsername] = useState('');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = `from=${from}&to=${to}&username=${encodeURIComponent(username.trim())}&action=${action}`;

  useEffect(() => { setPage(1); }, [query]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const t = setTimeout(() => {
      fetch(`/api/audit?${query}&page=${page}&limit=${PAGE_SIZE}`, { cache: 'no-store' })
        .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`); return j; })
        .then(j => { if (!cancelled) { setRows(j.rows); setTotal(j.total); } })
        .catch(err => { if (!cancelled) setError(err.message); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 250);   // debounce typing in the username box
    return () => { cancelled = true; clearTimeout(t); };
  }, [isAdmin, query, page]);

  if (sessionLoading) return <div className="card" style={{ padding: '2rem', textAlign: 'center' }}><span className="spinner" /></div>;
  if (!isAdmin) return <div className="card">This page is available to administrators only.</div>;

  const label = { fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.05em' };
  const th = { padding: '8px 10px', fontWeight: 600, textAlign: 'left' as const, whiteSpace: 'nowrap' as const };
  const td = { padding: '7px 10px', verticalAlign: 'top' as const };
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div style={{ marginBottom: '1.25rem' }}>
        <h1 className="section-title" style={{ fontSize: 18 }}>Audit Log</h1>
        <p className="section-subtitle">Who signed in and what they changed, viewed or exported (times in UTC+7, kept 365 days)</p>
      </div>

      <div className="card" style={{ padding: '0.875rem 1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          {([['From', from, setFrom], ['To', to, setTo]] as const).map(([l, v, set]) => (
            <div key={l} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={label}>{l}</label>
              <input type="date" className="input" value={v} onChange={e => set(e.target.value)}
                style={{ padding: '4px 8px', fontSize: 11, colorScheme: 'dark' }} />
            </div>
          ))}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={label}>Username</label>
            <input className="input" value={username} onChange={e => setUsername(e.target.value)} placeholder="any"
              style={{ padding: '4px 8px', fontSize: 11, width: 160 }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={label}>Action</label>
            <select className="input" value={action} onChange={e => setAction(e.target.value)} style={{ padding: '4px 8px', fontSize: 11 }}>
              {ACTIONS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </div>
          <a className="btn btn-primary" href={`/api/audit?${query}&format=csv`} style={{ padding: '5px 12px', fontSize: 11, textDecoration: 'none' }}>
            ⬇ Export CSV
          </a>
          <div style={{ flex: 1, textAlign: 'right', fontSize: 11, color: 'var(--text-muted)' }}>
            {loading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : `${total.toLocaleString()} entries`}
          </div>
        </div>
      </div>

      {error && (
        <div className="card" style={{ padding: '0.875rem 1rem', borderColor: 'var(--error)', color: 'var(--error-text)', marginBottom: '1rem', fontSize: 12 }}>{error}</div>
      )}

      <div className="card">
        {!rows && !error && <div style={{ padding: '2rem', textAlign: 'center' }}><span className="spinner spinner-lg" /></div>}
        {rows && (
          <div style={{ overflowX: 'auto', opacity: loading ? 0.6 : 1 }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                  <th style={th}>Time</th>
                  <th style={th}>User</th>
                  <th style={th}>Action</th>
                  <th style={th}>Target</th>
                  <th style={th}>Details</th>
                  <th style={th}>IP</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ ...td, whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{fmtTime(r.at)}</td>
                    <td style={td}>
                      <span style={{ fontFamily: 'monospace' }}>{r.username}</span>
                      {r.role && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{r.role}{r.customer ? ` · ${r.customer}` : ''}</div>}
                    </td>
                    <td style={td}>
                      <span className={`badge ${r.ok === false ? 'badge-error' : r.action.startsWith('user_') || r.action.startsWith('station_') ? 'badge-warn' : 'badge-info'}`}>
                        {actionLabel(r.action)}
                      </span>
                    </td>
                    <td style={{ ...td, fontFamily: 'monospace' }}>{r.target || ''}</td>
                    <td style={{ ...td, color: 'var(--text-secondary)', fontSize: 11, maxWidth: 420, wordBreak: 'break-word' }}>{fmtDetails(r.details)}</td>
                    <td style={{ ...td, fontFamily: 'monospace', color: 'var(--text-muted)', fontSize: 11 }}>{r.ip || ''}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: 'var(--text-muted)', padding: '1.5rem' }}>No entries for these filters</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, padding: '10px', fontSize: 11 }}>
            <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
            <span style={{ color: 'var(--text-muted)' }}>Page {page} / {pages}</span>
            <button className="btn btn-secondary btn-sm" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next →</button>
          </div>
        )}
      </div>
    </div>
  );
}
