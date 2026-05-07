'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Alert } from '@/lib/types';
import { fmtTs, timeSince } from '@/lib/formatTime';

const TYPE_LABELS: Record<Alert['type'], string> = {
  heartbeat:   'HB',
  temperature: 'TEMP',
  meter:       'MTR',
  power:       'PWR',
  fan:         'FAN',
  script:      'SCR',
  plc:         'PLC',
};

interface ApiAlert {
  _id?: string;
  id: string;
  stationId: string;
  stationName?: string;
  type: Alert['type'];
  severity: Alert['severity'];
  message: string;
  timestamp: string;
  acknowledged: boolean;
}

export default function AlertsPage() {
  const [alerts, setAlerts]     = useState<ApiAlert[]>([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState<'all' | 'unack' | 'critical' | 'warning'>('unack');
  const [error, setError]       = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // Fetch ALL alerts (acked + unacked) — change to ?all=1 if API supports
      const res = await fetch('/api/alerts');
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = await res.json();
      if (Array.isArray(data)) setAlerts(data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);   // refresh every 5s
    return () => clearInterval(t);
  }, [load]);

  const ack = async (id: string) => {
    // Optimistic update
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, acknowledged: true } : a));
    try {
      await fetch('/api/alerts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [id] }),
      });
    } catch {
      load();  // re-fetch on error to recover
    }
  };

  const ackAll = async () => {
    const ids = alerts.filter(a => !a.acknowledged).map(a => a.id);
    if (ids.length === 0) return;
    setAlerts(prev => prev.map(a => ({ ...a, acknowledged: true })));
    try {
      await fetch('/api/alerts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
    } catch {
      load();
    }
  };

  const filtered = alerts.filter(a => {
    if (filter === 'unack')    return !a.acknowledged;
    if (filter === 'critical') return a.severity === 'critical';
    if (filter === 'warning')  return a.severity === 'warning';
    return true;
  });

  const unackCount  = alerts.filter(a => !a.acknowledged).length;
  const critCount   = alerts.filter(a => a.severity === 'critical').length;
  const warnCount   = alerts.filter(a => a.severity === 'warning').length;

  return (
    <div>
      <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="section-title" style={{ fontSize: 18 }}>Alert Center</h1>
          <p className="section-subtitle">
            {loading ? 'Loading...' : `${unackCount} unacknowledged · ${alerts.length} total`}
            {error && <span style={{ color: 'var(--error-text)' }}> · API error: {error}</span>}
          </p>
        </div>
        {unackCount > 0 && (
          <button className="btn btn-secondary btn-sm" onClick={ackAll}>
            ✓ Acknowledge All
          </button>
        )}
      </div>

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
        {[
          { label: 'Total',          value: alerts.length, color: 'var(--text-primary)'  },
          { label: 'Unacknowledged', value: unackCount,    color: unackCount > 0 ? 'var(--error)' : 'var(--text-muted)' },
          { label: 'Critical',       value: critCount,     color: critCount > 0 ? 'var(--error)' : 'var(--text-muted)'  },
          { label: 'Warning',        value: warnCount,     color: warnCount > 0 ? 'var(--warn)' : 'var(--text-muted)'   },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '0.875rem' }}>
            <div className="stat-value" style={{ color: s.color, fontSize: 22 }}>{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="tabs" style={{ marginBottom: '1rem' }}>
        {(['all', 'unack', 'critical', 'warning'] as const).map(f => (
          <button
            key={f}
            className={`tab ${filter === f ? 'tab-active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? `All (${alerts.length})` :
             f === 'unack' ? `Unacked (${unackCount})` :
             f === 'critical' ? `Critical (${critCount})` :
             `Warning (${warnCount})`}
          </button>
        ))}
      </div>

      {/* Alert list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {!loading && filtered.length === 0 && (
          <div className="card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
            No alerts matching this filter
          </div>
        )}
        {filtered.map((alert, idx) => (
          <div key={alert._id || `${alert.id}-${idx}`} className="card" style={{
            borderColor: alert.acknowledged ? 'var(--border)' : alert.severity === 'critical' ? 'var(--error)' : 'var(--warn)',
            opacity: alert.acknowledged ? 0.6 : 1,
            padding: '0.875rem 1rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                background: alert.severity === 'critical' ? 'var(--error-bg)' : 'var(--warn-bg)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, color: alert.severity === 'critical' ? 'var(--error-text)' : 'var(--warn-text)',
              }}>
                {TYPE_LABELS[alert.type] || alert.type}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                  <span className={`badge ${alert.severity === 'critical' ? 'badge-error' : 'badge-warn'}`}>
                    {alert.severity.toUpperCase()}
                  </span>
                  <span className="badge badge-info" style={{ fontSize: 10 }}>{alert.type}</span>
                  <Link
                    href={`/station/${alert.stationId}`}
                    style={{ fontSize: 11, color: 'var(--info-text)', textDecoration: 'none' }}
                  >
                    {alert.stationName || alert.stationId} →
                  </Link>
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 4 }}>{alert.message}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  {fmtTs(alert.timestamp)} · {timeSince(alert.timestamp)}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                {alert.acknowledged ? (
                  <span className="badge badge-offline">Acknowledged</span>
                ) : (
                  <button className="btn btn-secondary btn-sm" onClick={() => ack(alert.id)}>
                    ✓ Ack
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
