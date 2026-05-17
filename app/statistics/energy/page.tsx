'use client';

import { useState, useEffect, useMemo } from 'react';
import { useStations } from '@/lib/hooks/useStations';
import LineChart from '@/components/ui/LineChart';

interface DailyAgg {
  date: string;
  head1: { sessions: number; totalKwh: number };
  head2: { sessions: number; totalKwh: number };
  updatedAt: string | null;
}

type Preset = '7d' | '30d' | 'month' | 'lastmonth' | 'custom';

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return toISODate(d);
}

function startOfMonth(d = new Date()): string {
  return toISODate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
}

function endOfMonth(d = new Date()): string {
  return toISODate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

function presetRange(p: Preset): { start: string; end: string } {
  const today = toISODate(new Date());
  if (p === '7d')        return { start: daysAgo(6), end: today };
  if (p === '30d')       return { start: daysAgo(29), end: today };
  if (p === 'month')     return { start: startOfMonth(),      end: today };
  if (p === 'lastmonth') {
    const lastMonth = new Date();
    lastMonth.setUTCDate(0); // last day of prev month
    return { start: startOfMonth(lastMonth), end: endOfMonth(lastMonth) };
  }
  return { start: daysAgo(6), end: today };
}

export default function ChargingReportPage() {
  const { stations } = useStations();
  const [stationId, setStationId] = useState<string>('');
  const [preset, setPreset] = useState<Preset>('7d');
  const [customStart, setCustomStart] = useState<string>(daysAgo(6));
  const [customEnd, setCustomEnd]     = useState<string>(toISODate(new Date()));
  const [data, setData] = useState<DailyAgg[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default to first station once list loads
  useEffect(() => {
    if (!stationId && stations.length > 0) {
      setStationId(stations[0].id);
    }
  }, [stations, stationId]);

  const range = useMemo(() => {
    if (preset === 'custom') return { start: customStart, end: customEnd };
    return presetRange(preset);
  }, [preset, customStart, customEnd]);

  // Fetch data when station or range changes
  useEffect(() => {
    if (!stationId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/energy?stationId=${encodeURIComponent(stationId)}&start=${range.start}&end=${range.end}`)
      .then(async r => {
        if (!r.ok) throw new Error(`API ${r.status}`);
        return r.json();
      })
      .then(d => { if (!cancelled) setData(d); })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [stationId, range.start, range.end]);

  const totals = useMemo(() => {
    if (!data) return { sessions: 0, kwh: 0, days: 0, avg: 0 };
    let sessions = 0, kwh = 0;
    for (const d of data) {
      sessions += d.head1.sessions + d.head2.sessions;
      kwh += d.head1.totalKwh + d.head2.totalKwh;
    }
    const days = data.length || 1;
    return { sessions, kwh, days, avg: kwh / days };
  }, [data]);

  const head1Series = useMemo(() =>
    (data || []).map(d => ({ timestamp: d.date + 'T00:00:00Z', value: d.head1.totalKwh })),
  [data]);

  const head2Series = useMemo(() =>
    (data || []).map(d => ({ timestamp: d.date + 'T00:00:00Z', value: d.head2.totalKwh })),
  [data]);

  const sessionsSeries = useMemo(() =>
    (data || []).map(d => ({ timestamp: d.date + 'T00:00:00Z', value: d.head1.sessions + d.head2.sessions })),
  [data]);

  const selectedStation = stations.find(s => s.id === stationId);

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '1.25rem' }}>
        <h1 className="section-title" style={{ fontSize: 18 }}>Energy Usage</h1>
        <p className="section-subtitle">Daily energy consumption per station (aggregated every 15 min)</p>
      </div>

      {/* Controls */}
      <div className="card" style={{ padding: '0.875rem 1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          {/* Station selector */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 200 }}>
            <label style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Station</label>
            <select
              className="input"
              value={stationId}
              onChange={e => setStationId(e.target.value)}
              style={{ fontSize: 13 }}
            >
              {stations.map(s => (
                <option key={s.id} value={s.id}>{s.displayName || s.name || s.id}</option>
              ))}
            </select>
          </div>

          {/* Preset selector */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Range</label>
            <div style={{ display: 'flex', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
              {([
                { id: '7d',        label: '7 days'     },
                { id: '30d',       label: '30 days'    },
                { id: 'month',     label: 'This month' },
                { id: 'lastmonth', label: 'Last month' },
                { id: 'custom',    label: 'Custom'     },
              ] as { id: Preset; label: string }[]).map((p, i, arr) => (
                <button
                  key={p.id}
                  onClick={() => setPreset(p.id)}
                  style={{
                    padding: '5px 12px', fontSize: 11, fontFamily: 'var(--font-geist-mono), monospace',
                    cursor: 'pointer', border: 'none',
                    background: preset === p.id ? 'var(--info-bg)' : 'transparent',
                    color:      preset === p.id ? 'var(--info-text)' : 'var(--text-secondary)',
                    fontWeight: preset === p.id ? 600 : 400,
                    borderRight: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Custom date inputs */}
          {preset === 'custom' && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Start</label>
                <input type="date" className="input" value={customStart} onChange={e => setCustomStart(e.target.value)} style={{ fontSize: 12 }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>End</label>
                <input type="date" className="input" value={customEnd} onChange={e => setCustomEnd(e.target.value)} style={{ fontSize: 12 }} />
              </div>
            </>
          )}

          <div style={{ flex: 1, textAlign: 'right', fontSize: 11, color: 'var(--text-muted)' }}>
            {selectedStation && (
              <>Showing <strong style={{ color: 'var(--text-secondary)' }}>{selectedStation.displayName || selectedStation.name}</strong> · {range.start} → {range.end}</>
            )}
          </div>
        </div>
      </div>

      {/* Summary tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
        {[
          { label: 'Total Sessions', value: totals.sessions.toLocaleString(), color: 'var(--info-text)' },
          { label: 'Total kWh',      value: totals.kwh.toFixed(1),            color: 'var(--ok-text)' },
          { label: 'Avg / Day',      value: `${totals.avg.toFixed(1)} kWh`,   color: 'var(--text-primary)' },
          { label: 'Days',           value: totals.days,                      color: 'var(--text-secondary)' },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '0.875rem 1rem' }}>
            <div className="stat-value" style={{ color: s.color, fontSize: 22 }}>{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {error && (
        <div className="card" style={{ padding: '1rem', borderColor: 'var(--error)', color: 'var(--error-text)', marginBottom: '1rem' }}>
          Error loading data: {error}
        </div>
      )}

      {loading && !data && (
        <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          Loading...
        </div>
      )}

      {/* Charts */}
      {data && data.length > 0 && (
        <>
          <div className="card" style={{ marginBottom: '1rem' }}>
            <div className="card-header">
              <span className="card-title">Daily kWh — Head 1</span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{range.start} → {range.end}</span>
            </div>
            <LineChart data={head1Series} height={200} color="var(--info)" unit=" kWh" />
          </div>

          <div className="card" style={{ marginBottom: '1rem' }}>
            <div className="card-header">
              <span className="card-title">Daily kWh — Head 2</span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{range.start} → {range.end}</span>
            </div>
            <LineChart data={head2Series} height={200} color="var(--warn)" unit=" kWh" />
          </div>

          <div className="card" style={{ marginBottom: '1rem' }}>
            <div className="card-header">
              <span className="card-title">Daily Sessions — Total (Head 1 + Head 2)</span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{range.start} → {range.end}</span>
            </div>
            <LineChart data={sessionsSeries} height={180} color="var(--ok)" unit="" />
          </div>

          {/* Detail table */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">Detail by day</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', textAlign: 'left' }}>
                    <th style={{ padding: '8px 10px', fontWeight: 600 }}>Date</th>
                    <th style={{ padding: '8px 10px', fontWeight: 600, textAlign: 'right' }}>H1 Sessions</th>
                    <th style={{ padding: '8px 10px', fontWeight: 600, textAlign: 'right' }}>H1 kWh</th>
                    <th style={{ padding: '8px 10px', fontWeight: 600, textAlign: 'right' }}>H2 Sessions</th>
                    <th style={{ padding: '8px 10px', fontWeight: 600, textAlign: 'right' }}>H2 kWh</th>
                    <th style={{ padding: '8px 10px', fontWeight: 600, textAlign: 'right' }}>Total kWh</th>
                  </tr>
                </thead>
                <tbody style={{ fontFamily: 'monospace' }}>
                  {[...data].reverse().map(d => {
                    const total = d.head1.totalKwh + d.head2.totalKwh;
                    return (
                      <tr key={d.date} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <td style={{ padding: '8px 10px', color: 'var(--text-secondary)' }}>{d.date}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--text-secondary)' }}>{d.head1.sessions}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--info-text)' }}>{d.head1.totalKwh.toFixed(2)}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--text-secondary)' }}>{d.head2.sessions}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--warn-text)' }}>{d.head2.totalKwh.toFixed(2)}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--text-primary)', fontWeight: 700 }}>{total.toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
