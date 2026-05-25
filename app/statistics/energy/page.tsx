'use client';

import { useState, useEffect, useMemo } from 'react';
import { useStations } from '@/lib/hooks/useStations';
import SearchSelect from '@/components/ui/SearchSelect';
import EnergyChart, { EnergyPoint } from '@/components/ui/EnergyChart';

interface DailyAgg {
  date: string;
  head1: { sessions: number; totalKwh: number };
  head2: { sessions: number; totalKwh: number };
  updatedAt: string | null;
}

type Preset = '7d' | '30d' | 'month';

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

function presetRange(p: Preset): { start: string; end: string } {
  const today = toISODate(new Date());
  if (p === '7d')    return { start: daysAgo(6),    end: today };
  if (p === '30d')   return { start: daysAgo(29),   end: today };
  if (p === 'month') return { start: startOfMonth(), end: today };
  return { start: daysAgo(6), end: today };
}

export default function ChargingReportPage() {
  const { stations } = useStations();
  const [stationId, setStationId] = useState<string>('');
  const [preset, setPreset] = useState<Preset>('7d');
  const [data, setData] = useState<DailyAgg[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default to first station once list loads
  useEffect(() => {
    if (!stationId && stations.length > 0) {
      setStationId(stations[0].id);
    }
  }, [stations, stationId]);

  const range = useMemo(() => presetRange(preset), [preset]);

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

  const chartData = useMemo<EnergyPoint[]>(() =>
    (data || []).map(d => ({
      date: d.date,
      head1Kwh: d.head1.totalKwh,
      head2Kwh: d.head2.totalKwh,
      head1Sessions: d.head1.sessions,
      head2Sessions: d.head2.sessions,
    })),
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
          {/* Station selector (searchable) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 240 }}>
            <label style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Station</label>
            <SearchSelect
              value={stationId}
              onChange={setStationId}
              options={stations.map(s => ({
                value: s.id,
                label: s.displayName || s.name || s.id,
                hint:  s.id !== (s.displayName || s.name) ? s.id : undefined,
              }))}
              placeholder="Search station..."
              width={260}
            />
          </div>

          {/* Preset selector */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Range</label>
            <div style={{ display: 'flex', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
              {([
                { id: '7d',    label: '7 days'     },
                { id: '30d',   label: '30 days'    },
                { id: 'month', label: 'This month' },
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
              <span className="card-title">Daily Energy (kWh)</span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{range.start} → {range.end}</span>
            </div>
            <EnergyChart data={chartData} height={260} mode="kwh" />
          </div>

          <div className="card" style={{ marginBottom: '1rem' }}>
            <div className="card-header">
              <span className="card-title">Daily Sessions</span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{range.start} → {range.end}</span>
            </div>
            <EnergyChart data={chartData} height={220} mode="sessions" />
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
