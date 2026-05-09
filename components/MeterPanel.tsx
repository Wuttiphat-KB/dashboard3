'use client';

import { MeterSnapshot, METER_MAX_KWH } from '@/lib/types';
import { getMeterLed } from '@/lib/mockData';
import { fmtTs, timeSince } from '@/lib/formatTime';
import LineChart from './ui/LineChart';

interface Props {
  history: MeterSnapshot[];
  stationId: string;
  chargerHeads?: number;
}

const WH_TO_KWH = (wh: number) => wh / 1000;
const fmtKwh    = (wh: number) => {
  const kwh = WH_TO_KWH(wh);
  return kwh >= 1000 ? `${(kwh / 1000).toFixed(3)} MWh` : `${kwh.toFixed(2)} kWh`;
};

// ── Fuel-gauge card for one meter head ───────────────────────────────────────
function MeterGauge({ valueWh, label, led, stalled, timestamp }: {
  valueWh: number; label: string;
  led: 'ok' | 'error'; stalled: boolean;
  timestamp: string;
}) {
  const kwh      = WH_TO_KWH(valueWh);
  const pct      = Math.min((kwh / METER_MAX_KWH) * 100, 100);
  const ledColor = led === 'ok' ? 'var(--ok)' : 'var(--error)';
  const barColor = pct > 85 ? 'var(--error)' : pct > 65 ? 'var(--warn)' : 'var(--ok)';

  return (
    <div style={{
      background: 'var(--bg-elevated)',
      borderRadius: 10,
      padding: '1.25rem',
      border: `1px solid ${stalled ? 'var(--error)' : 'var(--border-subtle)'}`,
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      {/* Header: LED + label + badge */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
            background: ledColor, boxShadow: `0 0 10px ${ledColor}`,
            animation: led === 'ok' ? 'pulse-led 2s ease-in-out infinite' : 'none',
          }} />
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{label}</span>
        </div>
        <span className={`badge ${led === 'ok' ? 'badge-ok' : 'badge-error'}`}>
          {led === 'ok' ? 'ACTIVE' : 'STALLED'}
        </span>
      </div>

      {/* Value */}
      <div>
        <div style={{ fontSize: 30, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>
          {kwh.toFixed(2)}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
          kWh &nbsp;·&nbsp; {valueWh.toLocaleString()} Wh raw
        </div>
      </div>

      {/* Gauge bar */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>
          <span>0 kWh</span>
          <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{pct.toFixed(1)}%</span>
          <span>{METER_MAX_KWH.toLocaleString()} kWh max</span>
        </div>
        <div style={{ height: 14, background: 'var(--bg-base)', borderRadius: 7, overflow: 'hidden', border: '1px solid var(--border-subtle)' }}>
          <div style={{
            height: '100%', width: `${pct}%`, borderRadius: 7,
            background: `linear-gradient(90deg, var(--ok), ${barColor})`,
            transition: 'width 0.5s ease',
          }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-muted)', marginTop: 2, padding: '0 2px' }}>
          <span>|</span><span>25%</span><span>|</span><span>50%</span><span>|</span><span>75%</span><span>|</span>
        </div>
      </div>

      {/* Stall warning */}
      {stalled && (
        <div style={{
          padding: '6px 10px', background: 'var(--error-bg)', borderRadius: 4,
          fontSize: 11, color: 'var(--error-text)', display: 'flex', alignItems: 'center', gap: 6,
        }}>
          Value unchanged for &gt; 2 days — LED set to RED
        </div>
      )}

      {/* ── Timestamp from MongoDB ── */}
      <div style={{
        padding: '8px 12px',
        background: 'var(--bg-base)',
        borderRadius: 6,
        border: '1px solid var(--border-subtle)',
      }}>
        <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>
          Last update (MongoDB)
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 600, color: 'var(--text-secondary)' }}>
            {fmtTs(timestamp)}
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>
            {timeSince(timestamp)}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function MeterPanel({ history, stationId, chargerHeads = 2 }: Props) {
  const latest = history[history.length - 1];
  const oldest = history[0];
  const showM2 = chargerHeads >= 2;

  const led1 = getMeterLed(history, 1);
  const led2 = getMeterLed(history, 2);

  const delta1Wh = latest && oldest ? latest.meter1Wh - oldest.meter1Wh : 0;
  const delta2Wh = latest && oldest ? latest.meter2Wh - oldest.meter2Wh : 0;

  const chartData1 = history.map(s => ({ timestamp: s.timestamp1, value: WH_TO_KWH(s.meter1Wh) }));
  const chartData2 = history.map(s => ({ timestamp: s.timestamp2, value: WH_TO_KWH(s.meter2Wh) }));

  const m1Label = showM2 ? 'Meter 1 (Head 1)' : 'Meter';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Meter gauges */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>
        <MeterGauge
          valueWh={latest?.meter1Wh ?? 0}
          label={m1Label}
          led={led1}
          stalled={led1 === 'error'}
          timestamp={latest?.timestamp1 ?? new Date(0).toISOString()}
        />
        {showM2 && (
          <MeterGauge
            valueWh={latest?.meter2Wh ?? 0}
            label="Meter 2 (Head 2)"
            led={led2}
            stalled={led2 === 'error'}
            timestamp={latest?.timestamp2 ?? new Date(0).toISOString()}
          />
        )}
      </div>

      {/* Delta stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem' }}>
        {[
          { label: showM2 ? 'Meter 1 +48h' : 'Meter +48h', value: fmtKwh(delta1Wh), color: delta1Wh > 0 ? 'var(--ok)' : 'var(--text-muted)', show: true },
          { label: 'Meter 2 +48h', value: fmtKwh(delta2Wh), color: delta2Wh > 0 ? 'var(--ok)' : 'var(--text-muted)', show: showM2 },
          { label: showM2 ? 'LED Meter 1' : 'LED Meter',  value: led1 === 'ok' ? '● Active' : '● Stalled', color: led1 === 'ok' ? 'var(--ok)' : 'var(--error)', show: true },
          { label: 'LED Meter 2',  value: led2 === 'ok' ? '● Active' : '● Stalled', color: led2 === 'ok' ? 'var(--ok)' : 'var(--error)', show: showM2 },
        ].filter(s => s.show).map(s => (
          <div key={s.label} className="card" style={{ padding: '0.75rem' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: s.color, marginBottom: 2 }}>{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1rem' }}>
        {([
          { data: chartData1, led: led1, label: showM2 ? 'Meter 1 (Head 1) — 48 h (kWh)' : 'Meter — 48 h (kWh)', ts: latest?.timestamp1, show: true },
          { data: chartData2, led: led2, label: 'Meter 2 (Head 2) — 48 h (kWh)', ts: latest?.timestamp2, show: showM2 },
        ] as const).filter(m => m.show).map((m) => (
          <div key={m.label} className="card">
            <div className="card-header">
              <span className="card-title">{m.label}</span>
              <span className={`badge ${m.led === 'ok' ? 'badge-ok' : 'badge-error'}`} style={{ fontSize: 10 }}>
                <span className={`led ${m.led === 'ok' ? 'led-ok' : 'led-error'}`} />
                {m.led === 'ok' ? 'Active' : 'Stalled'}
              </span>
            </div>
            <LineChart data={m.data} height={140} color={m.led === 'ok' ? 'var(--ok)' : 'var(--error)'} />
            {m.ts && (
              <div style={{ marginTop: 6, fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                Latest: {fmtTs(m.ts)} · {timeSince(m.ts)}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Recent readings table */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Recent Readings</span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{stationId} · from MongoDB</span>
        </div>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Record Time</th>
                <th>{showM2 ? 'Meter 1 ts' : 'Meter ts'}</th>
                <th>{showM2 ? 'Meter 1 (kWh)' : 'Meter (kWh)'}</th>
                <th>{showM2 ? 'Δ M1' : 'Δ'}</th>
                <th>LED</th>
                {showM2 && <>
                  <th>Meter 2 ts</th>
                  <th>Meter 2 (kWh)</th>
                  <th>Δ M2</th>
                  <th>LED</th>
                </>}
              </tr>
            </thead>
            <tbody>
              {history.slice(-8).reverse().map((snap, i, arr) => {
                const prev = arr[i + 1];
                const d1   = prev ? WH_TO_KWH(snap.meter1Wh) - WH_TO_KWH(prev.meter1Wh) : null;
                const d2   = prev ? WH_TO_KWH(snap.meter2Wh) - WH_TO_KWH(prev.meter2Wh) : null;
                const isLatest = i === 0;
                return (
                  <tr key={snap.timestamp}>
                    <td style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                      {fmtTs(snap.timestamp)}
                    </td>
                    <td style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                      {fmtTs(snap.timestamp1)}
                    </td>
                    <td style={{ fontWeight: 600 }}>{WH_TO_KWH(snap.meter1Wh).toFixed(2)}</td>
                    <td style={{ color: d1 && d1 > 0 ? 'var(--ok-text)' : 'var(--text-muted)', fontSize: 11 }}>
                      {d1 !== null ? (d1 > 0 ? `+${d1.toFixed(2)}` : d1.toFixed(2)) : '—'}
                    </td>
                    <td><span className={`led ${isLatest ? (led1 === 'ok' ? 'led-ok' : 'led-error') : 'led-offline'}`} /></td>
                    {showM2 && <>
                      <td style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                        {fmtTs(snap.timestamp2)}
                      </td>
                      <td style={{ fontWeight: 600 }}>{WH_TO_KWH(snap.meter2Wh).toFixed(2)}</td>
                      <td style={{ color: d2 && d2 > 0 ? 'var(--ok-text)' : 'var(--text-muted)', fontSize: 11 }}>
                        {d2 !== null ? (d2 > 0 ? `+${d2.toFixed(2)}` : d2.toFixed(2)) : '—'}
                      </td>
                      <td><span className={`led ${isLatest ? (led2 === 'ok' ? 'led-ok' : 'led-error') : 'led-offline'}`} /></td>
                    </>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* MongoDB note */}
      <div className="card" style={{ padding: '0.75rem 1rem', background: 'var(--info-bg)', border: '1px solid var(--border-subtle)' }}>
        <div style={{ fontSize: 11, color: 'var(--info-text)', fontWeight: 600, marginBottom: 4 }}>MongoDB Integration Note</div>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          Meter data forwarded to MongoDB on each MQTT message → fetched on load from
          <code style={{ background: 'var(--bg-base)', padding: '1px 4px', borderRadius: 3, margin: '0 3px' }}>
            {stationId.toLowerCase().replace('-', '')}_meter
          </code>.
          Raw values in Wh · displayed as kWh · max gauge = {METER_MAX_KWH.toLocaleString()} kWh.
          timestamp1 / timestamp2 = per-head update time from the charger.
        </div>
      </div>
    </div>
  );
}
