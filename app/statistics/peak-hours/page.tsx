'use client';

import { useState, useEffect, useMemo } from 'react';
import PeakHoursBarChart, { PeakHourPoint } from '@/components/ui/PeakHoursBarChart';
import PeakHoursHeatmap from '@/components/ui/PeakHoursHeatmap';

interface PeakHoursResponse {
  range: { from: string; to: string; days: number };
  hourly: PeakHourPoint[];
  heatmap: number[][];
  dayNames: readonly string[];
  totals: {
    totalKwh: number;
    peakHour: number;
    peakHourValue: number;
    peakHourPct: number;
    peakDay: number;
    peakDayName: string;
    peakDayValue: number;
    stationCount: number;
  };
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
function presetRange(p: Preset): { from: string; to: string } {
  const today = toISODate(new Date());
  if (p === '7d')    return { from: daysAgo(6),    to: today };
  if (p === '30d')   return { from: daysAgo(29),   to: today };
  if (p === 'month') return { from: startOfMonth(), to: today };
  return { from: daysAgo(6), to: today };
}

function fmtHourLabel(h: number): string {
  const start = String(h).padStart(2, '0');
  const end   = String((h + 1) % 24).padStart(2, '0');
  return `${start}:00 – ${end}:00`;
}

export default function PeakHoursPage() {
  const [preset, setPreset] = useState<Preset>('7d');
  const [data, setData] = useState<PeakHoursResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => presetRange(preset), [preset]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/statistics/peak-hours?from=${range.from}&to=${range.to}`)
      .then(async r => {
        if (!r.ok) throw new Error(`API ${r.status}`);
        return r.json();
      })
      .then(d => { if (!cancelled) setData(d); })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range.from, range.to]);

  const insight = useMemo(() => {
    if (!data) return '';
    const t = data.totals;
    if (t.totalKwh === 0) return 'No energy activity in this range yet.';
    return `Peak hour ${fmtHourLabel(t.peakHour)} contributes ${t.peakHourValue.toFixed(0)} kWh · ${t.peakHourPct.toFixed(1)}% of total energy across ${t.stationCount} stations.`;
  }, [data]);

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '1.25rem' }}>
        <h1 className="section-title" style={{ fontSize: 18 }}>Peak Hours</h1>
        <p className="section-subtitle">Fleet-wide hourly energy usage — identify when the network is busiest</p>
      </div>

      {/* Controls */}
      <div className="card" style={{ padding: '0.875rem 1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
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
            Fleet-wide · <strong style={{ color: 'var(--text-secondary)' }}>{range.from} → {range.to}</strong>
            {data && <> · {data.range.days} days · {data.totals.stationCount} stations</>}
          </div>
        </div>
      </div>

      {/* Summary tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
        {[
          {
            label: 'Peak Hour',
            value: data ? fmtHourLabel(data.totals.peakHour) : '—',
            color: 'var(--warn-text)',
            small: true,
          },
          {
            label: 'Peak Day',
            value: data ? data.totals.peakDayName : '—',
            color: 'var(--warn-text)',
          },
          {
            label: 'Total kWh',
            value: data ? data.totals.totalKwh.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—',
            color: 'var(--ok-text)',
          },
          {
            label: 'Stations',
            value: data ? data.totals.stationCount : '—',
            color: 'var(--info-text)',
          },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '0.875rem 1rem' }}>
            <div className="stat-value" style={{ color: s.color, fontSize: s.small ? 15 : 22 }}>{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Insight */}
      {data && (
        <div className="card" style={{
          padding: '0.75rem 1rem', marginBottom: '1rem',
          borderLeft: '3px solid var(--warn)',
          fontSize: 12, color: 'var(--text-secondary)',
        }}>
          💡 {insight}
        </div>
      )}

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
      {data && (
        <>
          <div className="card" style={{ marginBottom: '1rem' }}>
            <div className="card-header">
              <span className="card-title">Hourly Energy Distribution (24 h)</span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Local time · Thailand (ICT)</span>
            </div>
            <PeakHoursBarChart data={data.hourly} height={280} peakHour={data.totals.peakHour} />
          </div>

          <div className="card" style={{ marginBottom: '1rem' }}>
            <div className="card-header">
              <span className="card-title">Weekly Heatmap (Day × Hour)</span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Darker = more kWh</span>
            </div>
            <PeakHoursHeatmap
              data={data.heatmap}
              dayNames={data.dayNames}
              height={260}
              peakDay={data.totals.peakDay}
              peakHour={data.totals.peakHour}
            />
          </div>
        </>
      )}
    </div>
  );
}
