'use client';

import { RouterData, TempReading } from '@/lib/types';
import LineChart from './ui/LineChart';

interface Props {
  routerData: RouterData;
  tempHistory: TempReading[];
  stationId: string;
  tempThreshold?: number;
}

const THRESHOLD = 80;

// ── Thermometer SVG ──────────────────────────────────────────────────────────
function Thermometer({ tempC, threshold, stale }: { tempC: number; threshold: number; stale?: boolean }) {
  const pct   = Math.min(Math.max((tempC / 120) * 100, 0), 100);
  const color = stale ? 'var(--text-muted)' : tempC >= threshold ? 'var(--error)' : tempC >= threshold - 10 ? 'var(--warn)' : 'var(--ok)';
  const bulbH = 160;
  const fillH = stale ? 0 : (pct / 100) * (bulbH - 30);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <svg width="36" height="200" viewBox="0 0 36 200">
        {/* Tube outline */}
        <rect x="13" y="10" width="10" height={bulbH} rx="5" fill="var(--bg-base)" stroke="var(--border)" strokeWidth="1.5" />
        {/* Tube fill */}
        <rect
          x="14" y={10 + bulbH - fillH} width="8" height={fillH}
          rx="4" fill={color}
          style={{ transition: 'all 0.5s ease' }}
        />
        {/* Bulb */}
        <circle cx="18" cy={bulbH + 22} r="14" fill="var(--bg-base)" stroke="var(--border)" strokeWidth="1.5" />
        <circle cx="18" cy={bulbH + 22} r="10" fill={color} style={{ transition: 'fill 0.3s' }} />
        {/* Threshold tick */}
        <line x1="10" y1={10 + bulbH - (threshold / 120) * (bulbH - 30)} x2="26" y2={10 + bulbH - (threshold / 120) * (bulbH - 30)}
          stroke="var(--error)" strokeWidth="1.5" strokeDasharray="3,2" />
        {/* Ticks */}
        {[0, 25, 50, 75, 100, 120].map(t => (
          <g key={t}>
            <line x1="10" y1={10 + bulbH - (t / 120) * (bulbH - 30)} x2="12" y2={10 + bulbH - (t / 120) * (bulbH - 30)}
              stroke="var(--text-muted)" strokeWidth="1" />
            <text x="8" y={10 + bulbH - (t / 120) * (bulbH - 30) + 3}
              textAnchor="end" fontSize="7" fill="var(--text-muted)">{t}</text>
          </g>
        ))}
      </svg>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 24, fontWeight: 800, color, lineHeight: 1 }}>{stale ? '—' : tempC.toFixed(1)}</div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>°C</div>
      </div>
    </div>
  );
}

// ── Signal bar ───────────────────────────────────────────────────────────────
function SignalBars({ rssi }: { rssi: number }) {
  // RSSI: 0 → -120 dBm. Higher (less negative) = better.
  const levels = 4;
  const strength = rssi >= -65 ? 4 : rssi >= -75 ? 3 : rssi >= -85 ? 2 : rssi >= -95 ? 1 : 0;
  const color = strength >= 3 ? 'var(--ok)' : strength >= 2 ? 'var(--warn)' : 'var(--error)';
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 16 }}>
      {Array.from({ length: levels }, (_, i) => (
        <div key={i} style={{
          width: 4,
          height: `${((i + 1) / levels) * 100}%`,
          borderRadius: 1,
          background: i < strength ? color : 'var(--bg-elevated)',
          border: `1px solid ${i < strength ? color : 'var(--border)'}`,
        }} />
      ))}
    </div>
  );
}

const STALE_MS = 5 * 60 * 1000;

function isLastSeenStale(lastSeen: string | undefined | null): boolean {
  if (!lastSeen) return true;
  const t = new Date(lastSeen).getTime();
  if (isNaN(t)) return true;
  return Date.now() - t >= STALE_MS;
}

export default function TempPanel({ routerData, tempHistory, stationId, tempThreshold = THRESHOLD }: Props) {
  // No router data for ≥ 5 min → treat all router-derived values as empty.
  // Derive from lastSeen timestamp so the display always matches the age the user sees.
  const isStale     = !routerData.online || isLastSeenStale(routerData.lastSeen);
  const history     = isStale ? [] : tempHistory;
  const currentTemp = isStale ? 0 : routerData.tempRaw / 10;
  const maxTemp     = history.length ? Math.max(...history.map(r => r.value)) : 0;
  const avgTemp     = history.length ? history.reduce((s, r) => s + r.value, 0) / history.length : 0;
  const alertActive = !isStale && currentTemp >= tempThreshold;
  const isWarn      = !isStale && currentTemp >= tempThreshold - 10;
  const color       = isStale ? 'var(--text-muted)' : alertActive ? 'var(--error)' : isWarn ? 'var(--warn)' : 'var(--ok)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Alert banner */}
      {alertActive && (
        <div style={{
          padding: '12px 16px', background: 'var(--error-bg)', border: '1px solid var(--error)',
          borderRadius: 8, display: 'flex', alignItems: 'center', gap: 12,
          color: 'var(--error-text)', fontSize: 12, fontWeight: 600,
        }}>
          <span style={{ fontSize: 20 }}>⚠</span>
          <div>
            <div>Router temperature {currentTemp.toFixed(1)} °C exceeds threshold ({tempThreshold} °C)</div>
            <div style={{ fontWeight: 400, color: 'var(--text-secondary)', fontSize: 11, marginTop: 2 }}>
              Telegram alert triggered for station {stationId}
            </div>
          </div>
        </div>
      )}

      {/* Main card: thermometer + info */}
      <div className="card">
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {/* Thermometer */}
          <Thermometer tempC={currentTemp} threshold={tempThreshold} stale={isStale} />

          {/* Right column */}
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span className={`badge ${isStale ? 'badge-offline' : alertActive ? 'badge-error' : isWarn ? 'badge-warn' : 'badge-ok'}`} style={{ fontSize: 12, padding: '4px 12px' }}>
                <span className={`led ${isStale ? '' : alertActive ? 'led-error' : isWarn ? 'led-warn led-pulse' : 'led-ok led-pulse'}`} />
                {isStale ? 'NO DATA' : alertActive ? 'CRITICAL' : isWarn ? 'WARNING' : 'NORMAL'}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Threshold: {tempThreshold} °C → Telegram
              </span>
            </div>

            {/* Temp stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 8, marginBottom: 16 }}>
              {[
                { label: 'Current', value: isStale ? '—' : `${currentTemp.toFixed(1)} °C`, color },
                { label: 'Max 24h', value: isStale ? '—' : `${maxTemp.toFixed(1)} °C`, color: !isStale && maxTemp >= tempThreshold ? 'var(--error-text)' : 'var(--text-primary)' },
                { label: 'Avg 24h', value: isStale ? '—' : `${avgTemp.toFixed(1)} °C`, color: 'var(--text-secondary)' },
                { label: 'Raw',     value: isStale ? '—' : `${routerData.tempRaw}`, color: 'var(--text-muted)' },
              ].map(s => (
                <div key={s.label} style={{ background: 'var(--bg-elevated)', borderRadius: 6, padding: '8px 10px' }}>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 3 }}>{s.label}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: s.color }}>{s.value}</div>
                </div>
              ))}
            </div>

            <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '6px 0' }}>
              Raw value ÷ 10 = °C &nbsp;·&nbsp; Router model: {routerData.model} ({routerData.manuf})
            </div>
          </div>
        </div>
      </div>

      {/* Router signal info */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">⊕ Router Status &amp; Signal</span>
          <span className={`badge ${routerData.online ? 'badge-ok' : 'badge-error'}`}>
            <span className={`led ${routerData.online ? 'led-ok led-pulse' : 'led-error'}`} />
            {isStale ? 'Disconnected' : routerData.connstate}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          {/* Signal quality */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10 }}>Signal Quality</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {[
                { label: 'RSSI',     value: isStale ? '—' : `${routerData.rssi} dBm`,  extra: isStale ? null : <SignalBars rssi={routerData.rssi} /> },
                { label: 'RSRP',     value: isStale ? '—' : `${routerData.rsrp} dBm`,  extra: null },
                { label: 'RSRQ',     value: isStale ? '—' : `${routerData.rsrq} dB`,   extra: null },
                { label: 'SINR',     value: isStale ? '—' : `${routerData.sinr}`,       extra: null },
                { label: 'Type',     value: isStale ? '—' : routerData.conntype,        extra: null },
                { label: 'Operator', value: isStale ? '—' : routerData.operator,        extra: null },
              ].map(r => (
                <div key={r.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.label}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {r.extra}
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>{r.value}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Device info */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10 }}>Device Info</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {[
                { label: 'Model',  value: isStale ? '—' : routerData.model },
                { label: 'Manuf',  value: isStale ? '—' : routerData.manuf },
                { label: 'IMEI',   value: isStale ? '—' : routerData.imei },
                { label: 'ICCID',  value: isStale ? '—' : routerData.iccid },
                { label: 'IP',     value: isStale ? '—' : (routerData.ip.join(', ') || '—') },
              ].map(r => (
                <div key={r.label} style={{ padding: '4px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{r.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'monospace', wordBreak: 'break-all' }}>{r.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Temperature chart */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Router Temperature — 24 h (°C)</span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{stationId} · 30 min interval · raw ÷ 10</span>
        </div>
        <LineChart
          data={history}
          height={180}
          color={color}
          thresholdValue={tempThreshold}
          thresholdColor="var(--error)"
          unit="°"
        />
        <div style={{ marginTop: 6, fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 20, height: 2, backgroundImage: 'repeating-linear-gradient(90deg, var(--error) 0, var(--error) 6px, transparent 6px, transparent 10px)' }} />
          Alert threshold ({tempThreshold} °C) → Telegram notification
        </div>
      </div>
    </div>
  );
}
