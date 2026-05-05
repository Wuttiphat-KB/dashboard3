'use client';

import { FanSnapshot } from '@/lib/types';
import { fmtTime } from '@/lib/formatTime';

interface Props {
  fanData: FanSnapshot;
  stationId: string;
}

const FAN_MAX_RPM = 7000;

function FanCard({ name, rpm }: { name: string; rpm: number }) {
  const isIdle   = rpm === 0;
  const pct      = Math.min((rpm / FAN_MAX_RPM) * 100, 100);
  const color    = isIdle ? 'var(--text-muted)' : pct < 50 ? 'var(--warn)' : 'var(--ok)';
  const strokeLen = 2 * Math.PI * 36;

  return (
    <div className="card" style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
      padding: '1rem',
    }}>
      {/* Circular gauge */}
      <div style={{ position: 'relative' }}>
        <svg width="90" height="90" viewBox="0 0 90 90">
          <circle cx="45" cy="45" r="36" fill="none" stroke="var(--bg-elevated)" strokeWidth="7" />
          <circle
            cx="45" cy="45" r="36" fill="none"
            stroke={color} strokeWidth="7"
            strokeDasharray={`${(pct / 100) * strokeLen} ${strokeLen}`}
            strokeLinecap="round"
            transform="rotate(-90 45 45)"
            style={{ transition: 'stroke-dasharray 0.4s ease, stroke 0.3s ease' }}
          />
        </svg>
        {/* Center text — always show RPM */}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 14, fontWeight: 800, color, lineHeight: 1 }}>
            {(rpm / 1000).toFixed(1)}
          </span>
          <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>k RPM</span>
        </div>
      </div>

      {/* Fan name */}
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{name}</div>

      {/* RPM readout — replaces badge */}
      <div style={{
        padding: '3px 10px', borderRadius: 20,
        background: isIdle ? 'var(--bg-elevated)' : pct < 50 ? 'var(--warn-bg)' : 'var(--ok-bg)',
        border: `1px solid ${color}`,
        fontSize: 12, fontWeight: 800, color,
        fontFamily: 'monospace', letterSpacing: '0.03em',
      }}>
        {rpm.toFixed(0)} RPM
      </div>

      {/* Mini bar */}
      <div style={{ width: '100%' }}>
        <div className="gauge-track" style={{ height: 4 }}>
          <div className="gauge-fill" style={{ width: `${pct}%`, background: color }} />
        </div>
        <div style={{ fontSize: 9, color: 'var(--text-muted)', textAlign: 'center', marginTop: 2 }}>
          {pct.toFixed(0)}% of {(FAN_MAX_RPM / 1000).toFixed(0)}k max
        </div>
      </div>
    </div>
  );
}

export default function FanRPMPanel({ fanData, stationId }: Props) {
  const entries     = Object.entries(fanData.fans).sort((a, b) => {
    const n1 = parseInt(a[0].replace('FAN ', ''));
    const n2 = parseInt(b[0].replace('FAN ', ''));
    return n1 - n2;
  });
  const idleFans    = entries.filter(([, rpm]) => rpm === 0);
  const runningFans = entries.filter(([, rpm]) => rpm > 0);
  const totalRPM    = entries.reduce((s, [, rpm]) => s + rpm, 0);
  const avgRPM      = runningFans.length > 0 ? runningFans.reduce((s, [, r]) => s + r, 0) / runningFans.length : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem' }}>
        {[
          { label: 'Fans Running', value: `${runningFans.length}/${entries.length}`, color: runningFans.length > 0 ? 'var(--ok)' : 'var(--text-muted)' },
          { label: 'Fans Idle',    value: `${idleFans.length}`,                      color: idleFans.length > 0 ? 'var(--text-secondary)' : 'var(--text-muted)' },
          { label: 'Avg RPM',      value: `${avgRPM.toFixed(0)}`,                    color: 'var(--info)' },
          { label: 'Total RPM',    value: `${(totalRPM / 1000).toFixed(1)}k`,        color: 'var(--text-secondary)' },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '0.875rem' }}>
            <div className="stat-value" style={{ color: s.color, fontSize: 20 }}>{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Fan grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.75rem' }}>
        {entries.map(([name, rpm]) => (
          <FanCard key={name} name={name} rpm={rpm} />
        ))}
      </div>

      {/* Table */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">EBM Fan RPM Details</span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            {stationId} · MQTT: fanRPM · Updated {fmtTime(fanData.timestamp)}
          </span>
        </div>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Fan</th>
                <th>RPM</th>
                <th>Load</th>
                <th>% Max</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(([name, rpm]) => {
                const pct   = Math.min((rpm / FAN_MAX_RPM) * 100, 100);
                const isIdle = rpm === 0;
                const color  = isIdle ? 'var(--text-muted)' : pct < 50 ? 'var(--warn)' : 'var(--ok)';
                return (
                  <tr key={name}>
                    <td style={{ fontWeight: 600 }}>{name}</td>
                    <td style={{ fontWeight: 700, color, fontFamily: 'monospace' }}>
                      {rpm.toFixed(0)}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div className="gauge-track" style={{ width: 80 }}>
                          <div className="gauge-fill" style={{ width: `${pct}%`, background: color }} />
                        </div>
                      </div>
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 11 }}>{pct.toFixed(1)}%</td>
                    <td>
                      <span className={`badge ${isIdle ? 'badge-offline' : 'badge-ok'}`}>
                        <span className={`led ${isIdle ? '' : 'led-ok led-pulse'}`} />
                        {isIdle ? 'IDLE' : 'RUNNING'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
