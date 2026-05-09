'use client';

import { PlcData, PlcHeadData } from '@/lib/types';
import { fmtTs } from '@/lib/formatTime';

interface Props {
  plcData: PlcData;
  stationId: string;
  chargerHeads?: number;
}

function GaugeBar({ value, max, color = 'var(--info)' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="gauge-track">
      <div className="gauge-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

function chargeStateColor(s: string) {
  if (s === 'Charging') return { badge: 'badge-ok',      led: 'led-ok led-pulse',  text: 'var(--ok-text)' };
  if (s === 'Ready')    return { badge: 'badge-info',    led: 'led-info',           text: 'var(--info-text)' };
  if (s === 'Fault')    return { badge: 'badge-error',   led: 'led-error',          text: 'var(--error-text)' };
  if (s === 'Offline')  return { badge: 'badge-offline', led: 'led-offline',        text: 'var(--offline)' };
  return { badge: 'badge-warn', led: 'led-warn', text: 'var(--warn-text)' };
}

function HeadCard({ head }: { head: PlcHeadData }) {
  const sc = chargeStateColor(head.chargeState);
  const isCharging = head.chargeState === 'Charging';
  const hasFault   = head.chargeState === 'Fault' || head.headError !== 0;

  return (
    <div className="card" style={{ borderColor: hasFault ? 'var(--error)' : 'var(--border)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8,
            background: 'var(--info-bg)', color: 'var(--info-text)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, fontWeight: 800,
          }}>{head.head}</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Head {head.head}</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Charger Head</div>
          </div>
        </div>
        <span className={`badge ${sc.badge}`} style={{ fontSize: 12 }}>
          <span className={`led ${sc.led}`} />
          {head.chargeState.toUpperCase()}
        </span>
      </div>

      {/* Fault message */}
      {hasFault && head.errorMessage && (
        <div style={{
          marginBottom: 12, padding: '6px 10px',
          background: 'var(--error-bg)', borderRadius: 4,
          fontSize: 11, color: 'var(--error-text)',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          ⚠ {head.errorMessage}
        </div>
      )}

      {/* SOC */}
      {isCharging && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>
            <span>State of Charge (SOC)</span>
            <span style={{ fontWeight: 700, color: 'var(--ok-text)', fontSize: 14 }}>{head.soc}%</span>
          </div>
          <div style={{ height: 12, background: 'var(--bg-elevated)', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border-subtle)' }}>
            <div style={{
              height: '100%', width: `${head.soc}%`, borderRadius: 6,
              background: head.soc < 20 ? 'var(--error)' : head.soc < 50 ? 'var(--warn)' : 'var(--ok)',
              transition: 'width 0.4s ease',
            }} />
          </div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>
            iRessState: {head.iRessState} · ActiveMLD: {head.activeMld}
          </div>
        </div>
      )}

      {/* Electrical: Present vs Target */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
        {[
          { label: 'Present Voltage',  value: `${head.presentVoltage} V`,  target: `→ ${head.targetVoltage} V`, color: 'var(--info-text)'  },
          { label: 'Present Current',  value: `${head.presentCurrent} A`,  target: `→ ${head.targetCurrent} A`, color: 'var(--ok-text)'   },
          { label: 'Power',            value: `${head.powerKw} kW`,         target: `max ${(head.maxPower / 1000).toFixed(0)} kW`, color: 'var(--warn-text)' },
          { label: 'Measured Voltage', value: `${head.measuredVoltage.toFixed(1)} V`, target: '', color: 'var(--text-secondary)' },
        ].map(s => (
          <div key={s.label} style={{ background: 'var(--bg-elevated)', borderRadius: 6, padding: '8px 10px' }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 3 }}>{s.label}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: isCharging ? s.color : 'var(--text-muted)' }}>{isCharging ? s.value : '—'}</div>
            {s.target && <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1 }}>{s.target}</div>}
          </div>
        ))}
      </div>

      {/* Power gauge */}
      {isCharging && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>
            <span>Power output</span><span>{head.powerKw} kW / {(head.maxPower / 1000).toFixed(0)} kW</span>
          </div>
          <GaugeBar value={head.powerKw} max={head.maxPower / 1000} color="var(--warn)" />
        </div>
      )}

      {/* Temperatures */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Temperatures</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
          {[
            { label: 'Head Top',    value: head.temp1Head,        warn: 75 },
            { label: 'Head Bot',    value: head.temp2Head,        warn: 75 },
            { label: 'Power Mod',   value: head.tempPowerModule,  warn: 60 },
          ].map(s => (
            <div key={s.label} style={{ background: 'var(--bg-elevated)', borderRadius: 6, padding: '7px 8px', textAlign: 'center' }}>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 3 }}>{s.label}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: s.value >= s.warn ? 'var(--warn-text)' : 'var(--text-secondary)' }}>
                {head.chargeState === 'Offline' ? '—' : `${s.value} °C`}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Status flags */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {[
          { label: 'Fan',    active: head.fanStatus === 1 },
          { label: 'CP OK',  active: head.cpStatus > 0 },
          { label: 'Insu',   active: head.insulationFault === 0 },
          { label: `CP ${head.cpStatus}`,    active: true, info: true },
          { label: `ICP ${head.icp}`,        active: true, info: true },
        ].map(f => (
          <span key={f.label} style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            padding: '2px 6px', borderRadius: 4, fontSize: 10,
            background: f.info ? 'var(--bg-elevated)' : f.active ? 'var(--ok-bg)' : 'var(--error-bg)',
            color: f.info ? 'var(--text-muted)' : f.active ? 'var(--ok-text)' : 'var(--error-text)',
            border: `1px solid ${f.info ? 'var(--border-subtle)' : f.active ? 'transparent' : 'var(--error)'}`,
          }}>
            {!f.info && <span className={`led ${f.active ? 'led-ok' : 'led-error'}`} style={{ width: 6, height: 6 }} />}
            {f.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function ComponentStatus({ label, status }: { label: string; status: string }) {
  const isActive = status === 'Active';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '8px 12px',
      background: isActive ? 'var(--ok-bg)' : 'var(--error-bg)',
      borderRadius: 6, border: `1px solid ${isActive ? 'transparent' : 'var(--error)'}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className={`led ${isActive ? 'led-ok led-pulse' : 'led-error'}`} />
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</span>
      </div>
      <span className={`badge ${isActive ? 'badge-ok' : 'badge-error'}`} style={{ fontSize: 10 }}>
        {status.toUpperCase()}
      </span>
    </div>
  );
}

export default function PlcPanel({ plcData, stationId, chargerHeads = 2 }: Props) {
  const showHead2  = chargerHeads >= 2;
  const totalPower = plcData.head1.powerKw + (showHead2 ? plcData.head2.powerKw : 0);

  const summaryStats = [
    { label: 'Total Power',  value: `${totalPower} kW`,                           color: 'var(--info)'  },
    { label: showHead2 ? 'Head 1 State' : 'Charge State', value: plcData.head1.chargeState, color: chargeStateColor(plcData.head1.chargeState).text },
    ...(showHead2 ? [{ label: 'Head 2 State', value: plcData.head2.chargeState, color: chargeStateColor(plcData.head2.chargeState).text }] : []),
    { label: 'Ambient Temp', value: `${plcData.ambientTemp.toFixed(1)} °C`,       color: 'var(--text-secondary)' },
    { label: 'Pi5 Temp',     value: `${plcData.pi5Temp.toFixed(1)} °C`,           color: plcData.pi5Temp > 70 ? 'var(--warn-text)' : 'var(--text-secondary)' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem' }}>
        {summaryStats.map(s => (
          <div key={s.label} className="card" style={{ padding: '0.875rem' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: s.color, marginBottom: 2 }}>{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Head cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '1rem' }}>
        <HeadCard head={plcData.head1} />
        {showHead2 && <HeadCard head={plcData.head2} />}
      </div>

      {/* System component status */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">System Component Status</span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{stationId} · PLC payload</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.5rem' }}>
          <ComponentStatus label="HMI"   status={plcData.hmiStatus}  />
          <ComponentStatus label="PLC 1" status={plcData.plc1Status} />
          <ComponentStatus label="PLC 2" status={plcData.plc2Status} />
          <ComponentStatus label="LEM 1" status={plcData.lem1Status} />
          <ComponentStatus label="LEM 2" status={plcData.lem2Status} />
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 12px',
            background: plcData.fanStatus1_8 === '1' ? 'var(--ok-bg)' : 'var(--error-bg)',
            borderRadius: 6,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className={`led ${plcData.fanStatus1_8 === '1' ? 'led-ok led-pulse' : 'led-error'}`} />
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>Fan Status (1-8)</span>
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: plcData.fanStatus1_8 === '1' ? 'var(--ok-text)' : 'var(--error-text)' }}>
              {plcData.fanStatus1_8}
            </span>
          </div>
        </div>
      </div>

      {/* Ambient sensors */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Ambient Sensors</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem' }}>
          {[
            { label: 'Temperature',  value: `${plcData.ambientTemp.toFixed(2)} °C`,       icon: '◉', color: plcData.ambientTemp > 50 ? 'var(--warn-text)' : 'var(--text-primary)' },
            { label: 'Humidity',     value: `${plcData.ambientHum.toFixed(2)} %`,          icon: '◎', color: 'var(--info-text)' },
            { label: 'Pressure',     value: `${plcData.ambientPressure.toFixed(2)} hPa`,   icon: '▣', color: 'var(--text-secondary)' },
            { label: 'Pi5 Temp',     value: `${plcData.pi5Temp.toFixed(1)} °C`,            icon: '◈', color: plcData.pi5Temp > 70 ? 'var(--warn-text)' : 'var(--text-secondary)' },
          ].map(s => (
            <div key={s.label} style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '12px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: 20, color: s.color, marginBottom: 4 }}>{s.icon}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', marginTop: 4 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Timestamp */}
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'right' }}>
        Last PLC payload: {fmtTs(plcData.timestamp)}
      </div>
    </div>
  );
}
