'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { getMeterLed } from '@/lib/mockData';
import { useFleet } from '@/lib/hooks/useFleet';
import { StationDashboardData, Station, METER_MAX_KWH } from '@/lib/types';

const OVERVIEW_TYPES = [
  { id: 'heartbeat',   label: 'Heartbeat'    },
  { id: 'powermodule', label: 'Power Module' },
  { id: 'meter',       label: 'Meter'        },
  { id: 'temperature', label: 'Temperature'  },
  { id: 'fanrpm',      label: 'Fan RPM'      },
  { id: 'scripts',     label: 'MQTT Scripts' },
] as const;

import { timeSince, fmtTs } from '@/lib/formatTime';

function StatusBadge({ status }: { status: 'online' | 'degraded' | 'offline' }) {
  const m = {
    online:   { badge: 'badge-ok',    led: 'led-ok led-pulse'   },
    degraded: { badge: 'badge-warn',  led: 'led-warn led-pulse'  },
    offline:  { badge: 'badge-error', led: 'led-error'           },
  };
  return (
    <span className={`badge ${m[status].badge}`}>
      <span className={`led ${m[status].led}`} />
      {status.toUpperCase()}
    </span>
  );
}

function deriveStatus(data: StationDashboardData): 'online' | 'degraded' | 'offline' {
  const hbs = data.heartbeats;
  const onCnt = hbs.filter(h => h.online).length;
  return onCnt === 0 ? 'offline' : onCnt === hbs.length ? 'online' : 'degraded';
}

function Shell({ station, data, children, customBadge, borderColor }: {
  station: Station;
  data: StationDashboardData;
  children: React.ReactNode;
  customBadge?: React.ReactNode;
  borderColor?: string;
}) {
  const st = deriveStatus(data);
  const defaultBorder = st === 'offline' ? 'var(--error)' : st === 'degraded' ? 'var(--warn)' : 'var(--border)';
  return (
    <div className="card" style={{
      borderColor: borderColor ?? defaultBorder,
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{station.displayName}</div>
        </div>
        {customBadge ?? <StatusBadge status={st} />}
      </div>
      <div style={{ height: 1, background: 'var(--border-subtle)' }} />
      {children}
      <Link href={`/station/${station.id}`} style={{ fontSize: 12, color: 'var(--info-text)', textDecoration: 'none', textAlign: 'right', marginTop: 2 }}>
        View station →
      </Link>
    </div>
  );
}


// ── Heartbeat ─────────────────────────────────────────────────────────────────
function HeartbeatCard({ station, data }: { station: Station; data: StationDashboardData }) {
  return (
    <Shell station={station} data={data}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {data.heartbeats.map(hb => (
          <div key={hb.key} style={{
            padding: '8px 10px',
            background: hb.online ? 'var(--ok-bg)' : 'var(--error-bg)',
            borderRadius: 6,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span className={`led ${hb.online ? 'led-ok led-pulse' : 'led-error'}`} />
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{hb.name}</span>
                {hb.key === 'router' && hb.connstate && (
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{hb.connstate}</span>
                )}
              </div>
              <span style={{ fontSize: 12, color: hb.online ? 'var(--ok-text)' : 'var(--error-text)', fontWeight: 700 }}>
                {timeSince(hb.lastSeen)}
              </span>
            </div>
            <div style={{ fontSize: 11, fontFamily: 'monospace', color: hb.online ? 'var(--text-muted)' : 'var(--error-text)', paddingLeft: 17 }}>
              {fmtTs(hb.lastSeen)}
            </div>
          </div>
        ))}
      </div>
    </Shell>
  );
}

// ── Charge state badge (shared) ──────────────────────────────────────────────
function ChargeStateBadge({ state, powerKw, soc }: { state: string; powerKw: number; soc: number }) {
  const isCharging = state === 'Charging';
  const isFault    = state === 'Fault';
  const badgeCls   = isCharging ? 'badge-warn' : isFault ? 'badge-error' : 'badge-offline';
  const ledCls     = isCharging ? 'led-warn led-pulse' : isFault ? 'led-error' : '';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span className={`badge ${badgeCls}`}>
        <span className={`led ${ledCls}`} />
        {state}
      </span>
      {isCharging && (
        <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'monospace', color: 'var(--warn-text)' }}>
          {powerKw} kW · SOC {soc}%
        </span>
      )}
    </div>
  );
}

// ── Power Module ──────────────────────────────────────────────────────────────
// Status here means PM completeness vs expected count, NOT device online/offline.
function PowerModuleCard({ station, data }: { station: Station; data: StationDashboardData }) {
  const numHeads = station.chargerHeads || 2;
  const plcHeads = numHeads >= 2 ? [data.plcData.head1, data.plcData.head2] : [data.plcData.head1];
  const expFor = (head: number) =>
    head === 1 ? (station.expectedPmHead1 ?? station.expectedPmPerHead)
               : (station.expectedPmHead2 ?? station.expectedPmPerHead);

  // Determine PM completeness across all heads
  const headStatuses = data.powerModuleHeads.map(h => {
    const exp = expFor(h.head);
    const missing = Math.max(0, exp - h.pmCount);
    return { head: h.head, pmCount: h.pmCount, expected: exp, missing, isFull: missing === 0 && exp > 0 };
  });
  const allFull = headStatuses.every(s => s.isFull);
  const anyMissing = headStatuses.some(s => s.missing > 0);

  // Card-level status: FULL (green) / INCOMPLETE (warn) — no offline concept
  const cardBorder = allFull ? 'var(--ok)' : anyMissing ? 'var(--warn)' : 'var(--border)';
  const cardBadge = (
    <span className={`badge ${allFull ? 'badge-ok' : 'badge-warn'}`}>
      <span className={`led ${allFull ? 'led-ok led-pulse' : 'led-warn led-pulse'}`} />
      {allFull ? 'FULL' : 'INCOMPLETE'}
    </span>
  );

  return (
    <Shell station={station} data={data} customBadge={cardBadge} borderColor={cardBorder}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {data.powerModuleHeads.map(h => {
          const exp = expFor(h.head);
          const missing = Math.max(0, exp - h.pmCount);
          const isFull = missing === 0 && exp > 0;
          const color  = isFull ? 'var(--ok)' : 'var(--warn)';
          const bg     = isFull ? 'var(--ok-bg)' : 'var(--warn-bg)';
          const border = isFull ? 'transparent' : 'var(--warn)';
          const plc    = plcHeads.find(p => p.head === h.head);

          return (
            <div key={h.head} style={{ padding: '10px 12px', background: bg, borderRadius: 8, border: `1px solid ${border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: 4,
                    background: 'var(--info-bg)', color: 'var(--info-text)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 700,
                  }}>{h.head}</div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>Head {h.head}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <span style={{ fontSize: 28, fontWeight: 900, color, lineHeight: 1 }}>
                    {h.pmCount}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>/ {exp} PM</span>
                </div>
              </div>
              {missing > 0 && (
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--warn-text)', marginBottom: 6 }}>
                  ⚠ {missing} module{missing > 1 ? 's' : ''} missing
                </div>
              )}
              {plc && (
                <div style={{ marginBottom: 6 }}>
                  <ChargeStateBadge state={plc.chargeState} powerKw={plc.powerKw} soc={plc.soc} />
                </div>
              )}
              <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                {fmtTs(h.timestamp)} · {timeSince(h.timestamp)}
              </div>
            </div>
          );
        })}
      </div>
    </Shell>
  );
}

// ── Meter ─────────────────────────────────────────────────────────────────────
// Status here = "stalled" (no value change > 2 days), NOT online/offline.

/** Smooth gradient: 0% green → 50% yellow → 100% red */
function gaugeGradient(pct: number): string {
  // Hue: 120 (green) at 0%, 60 (yellow) at 50%, 0 (red) at 100%
  const hue = Math.max(0, Math.min(120, 120 - (pct * 1.2)));
  return `hsl(${hue}, 70%, 50%)`;
}

function MeterCard({ station, data }: { station: Station; data: StationDashboardData }) {
  // Stalled flags come from API (server-side compared >2-day-old doc)
  const meterMeta = (data as any).__meterMeta || {};
  const stalled1 = !!meterMeta.stalled1;
  const stalled2 = !!meterMeta.stalled2;
  const latest = data.meterHistory[data.meterHistory.length - 1];
  const toKwh  = (wh: number) => (wh / 1000).toFixed(1);
  const numHeads = station.chargerHeads || 2;

  const meters = [
    { n: '1', stalled: stalled1, val: latest?.meter1Wh ?? 0, ts: latest?.timestamp1 ?? '' },
    ...(numHeads >= 2 ? [{ n: '2', stalled: stalled2, val: latest?.meter2Wh ?? 0, ts: latest?.timestamp2 ?? '' }] : []),
  ];

  const anyStalled = stalled1 || (numHeads >= 2 && stalled2);
  const cardBorder = anyStalled ? 'var(--error)' : 'var(--border)';
  const cardBadge  = anyStalled ? (
    <span className="badge badge-error">
      <span className="led led-error" />
      STALLED
    </span>
  ) : (
    <span className="badge badge-ok">
      <span className="led led-ok led-pulse" />
      ACTIVE
    </span>
  );

  return (
    <Shell station={station} data={data} customBadge={cardBadge} borderColor={cardBorder}>
      {meters.map(({ n, stalled, val, ts }) => {
        const pct = Math.min((val / 1000 / METER_MAX_KWH) * 100, 100);
        const ledColor = stalled ? 'var(--error)' : 'var(--ok)';
        const fillColor = stalled ? 'var(--error)' : gaugeGradient(pct);
        return (
          <div key={n} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <div style={{
                  width: 12, height: 12, borderRadius: '50%',
                  background: ledColor,
                  boxShadow: `0 0 6px ${ledColor}`,
                  animation: stalled ? 'none' : 'pulse-led 2s ease-in-out infinite',
                }} />
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{numHeads > 1 ? `Meter ${n} (Head ${n})` : 'Meter'}</span>
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{toKwh(val)} kWh</span>
            </div>
            <div style={{ height: 7, background: 'var(--bg-elevated)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: fillColor, borderRadius: 4, transition: 'width 0.4s, background 0.3s' }} />
            </div>
            {ts && (
              <div style={{ fontSize: 10, fontFamily: 'monospace', color: stalled ? 'var(--error-text)' : 'var(--text-muted)' }}>
                {stalled ? 'Stalled · ' : ''}Last: {fmtTs(ts)} · {timeSince(ts)}
              </div>
            )}
          </div>
        );
      })}
    </Shell>
  );
}

// ── Temperature ───────────────────────────────────────────────────────────────
// Status here = temperature level (NORMAL / WARNING / CRITICAL), not online/offline.

interface RssiCategory { label: string; color: string; bg: string; }
function rssiCategory(rssi: number): RssiCategory {
  if (rssi === 0) return { label: '—',         color: 'var(--text-muted)',     bg: 'var(--bg-elevated)' };
  if (rssi >= -70) return { label: 'Excellent', color: '#1a7f37',               bg: 'rgba(63, 185, 80, 0.18)' };
  if (rssi >= -80) return { label: 'Good',      color: '#9a8a00',               bg: 'rgba(210, 180, 50, 0.20)' };
  if (rssi >= -90) return { label: 'Fair',      color: '#b35900',               bg: 'rgba(255, 140, 50, 0.22)' };
  return            { label: 'Weak',      color: '#a40e26',               bg: 'rgba(248, 81, 73, 0.20)' };
}

function TemperatureCard({ station, data }: { station: Station; data: StationDashboardData }) {
  const current = data.routerData.tempRaw / 10;
  const hasData = current > 0;

  // Temperature thresholds — NOT related to online/offline
  const isCritical = current >= 80;
  const isWarning  = current >= 70 && current < 80;
  const tempColor  = !hasData ? 'var(--text-muted)' : isCritical ? 'var(--error)' : isWarning ? 'var(--warn)' : 'var(--ok)';
  const pct        = Math.min((current / 120) * 100, 100);

  const rssi = data.routerData.rssi || 0;
  const rssiCat = rssiCategory(rssi);

  // Card-level status from temperature, not heartbeat
  const cardBorder = isCritical ? 'var(--error)' : isWarning ? 'var(--warn)' : 'var(--border)';
  const cardBadge = (
    <span className={`badge ${isCritical ? 'badge-error' : isWarning ? 'badge-warn' : 'badge-ok'}`}>
      <span className={`led ${isCritical ? 'led-error' : isWarning ? 'led-warn led-pulse' : 'led-ok led-pulse'}`} />
      {!hasData ? 'NO DATA' : isCritical ? 'CRITICAL' : isWarning ? 'WARNING' : 'NORMAL'}
    </span>
  );

  const r = 34;
  const C = 2 * Math.PI * r;

  // Larger gauge — temperature is the hero element
  const gaugeR = 52;
  const gaugeC = 2 * Math.PI * gaugeR;
  const gaugeSize = 130;

  return (
    <Shell station={station} data={data} customBadge={cardBadge} borderColor={cardBorder}>
      {/* HERO: Big centered temperature gauge */}
      <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 6px' }}>
        <div style={{ position: 'relative' }}>
          <svg width={gaugeSize} height={gaugeSize} viewBox={`0 0 ${gaugeSize} ${gaugeSize}`}>
            <circle cx={gaugeSize / 2} cy={gaugeSize / 2} r={gaugeR} fill="none" stroke="var(--bg-elevated)" strokeWidth="9" />
            <circle cx={gaugeSize / 2} cy={gaugeSize / 2} r={gaugeR} fill="none"
              stroke={tempColor} strokeWidth="9"
              strokeDasharray={`${(pct / 100) * gaugeC} ${gaugeC}`}
              strokeLinecap="round" transform={`rotate(-90 ${gaugeSize / 2} ${gaugeSize / 2})`}
              style={{ transition: 'stroke-dasharray 0.4s ease, stroke 0.3s ease' }} />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 38, fontWeight: 900, color: tempColor, lineHeight: 1, letterSpacing: '-0.02em' }}>
              {hasData ? current.toFixed(0) : '—'}
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', marginTop: 4, letterSpacing: '0.05em' }}>°C</span>
          </div>
        </div>
      </div>

      {/* Secondary: compact RSSI pill */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '4px 2px' }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Signal
        </span>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 7,
          padding: '3px 10px', borderRadius: 12,
          background: rssiCat.bg, border: `1px solid ${rssiCat.color}`,
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: rssiCat.color, letterSpacing: '0.02em' }}>
            {rssiCat.label}
          </span>
          <span style={{ fontSize: 11, fontWeight: 600, color: rssiCat.color, fontFamily: 'monospace', opacity: 0.85 }}>
            {rssi !== 0 ? `${rssi}` : '—'} <span style={{ fontSize: 9, opacity: 0.7 }}>dBm</span>
          </span>
        </div>
      </div>

      <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)' }}>
        Last: {fmtTs(data.routerData.lastSeen)} · {timeSince(data.routerData.lastSeen)}
      </div>
    </Shell>
  );
}

// ── Fan RPM ───────────────────────────────────────────────────────────────────
function FanRPMCard({ station, data }: { station: Station; data: StationDashboardData }) {
  const FAN_MAX  = 7000;
  const entries  = Object.entries(data.fanData.fans).sort((a, b) =>
    parseInt(a[0].replace('FAN ', '')) - parseInt(b[0].replace('FAN ', ''))
  );
  const runningN = entries.filter(([, r]) => r > 0).length;
  const numHeads = station.chargerHeads || 2;
  const plcHeads = numHeads >= 2 ? [data.plcData.head1, data.plcData.head2] : [data.plcData.head1];

  return (
    <Shell station={station} data={data}>
      {/* Charge state per head */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 2 }}>
        {plcHeads.map(p => (
          <div key={p.head} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            {numHeads > 1 && (
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', width: 20, flexShrink: 0 }}>H{p.head}</span>
            )}
            <ChargeStateBadge state={p.chargeState} powerKw={p.powerKw} soc={p.soc} />
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {entries.map(([name, rpm]) => {
          const pct  = Math.min((rpm / FAN_MAX) * 100, 100);
          const isIdle = rpm === 0;
          const fc   = isIdle ? 'var(--text-muted)' : pct < 50 ? 'var(--warn)' : 'var(--ok)';
          return (
            <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 38, flexShrink: 0 }}>{name}</span>
              <div className="gauge-track" style={{ flex: 1, height: 5 }}>
                <div className="gauge-fill" style={{ width: `${pct}%`, background: fc, height: '100%' }} />
              </div>
              <span style={{ fontSize: 11, color: fc, width: 64, textAlign: 'right', fontWeight: 600, flexShrink: 0, fontFamily: 'monospace' }}>
                {isIdle ? '0' : `${(rpm / 1000).toFixed(1)}k`}
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        {runningN}/{entries.length} fans running
      </div>
    </Shell>
  );
}

// ── MQTT Scripts ──────────────────────────────────────────────────────────────
function ScriptsCard({ station, data }: { station: Station; data: StationDashboardData }) {
  const online  = data.scripts.filter(s => s.online).length;
  const offline = data.scripts.filter(s => !s.online);
  return (
    <Shell station={station} data={data}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: online === data.scripts.length ? 'var(--ok)' : 'var(--warn-text)' }}>
          {online}<span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 400 }}>/{data.scripts.length}</span>
        </div>
        <span className={`badge ${offline.length === 0 ? 'badge-ok' : 'badge-warn'}`}>
          {offline.length === 0 ? 'ALL RUNNING' : `${offline.length} STOPPED`}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {data.scripts.map(s => (
          <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className={`led ${s.online ? 'led-ok led-pulse' : 'led-error'}`} />
            <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-secondary)', flex: 1 }}>{s.name}.py</span>
            <span style={{ fontSize: 10, color: s.online ? 'var(--text-muted)' : 'var(--error-text)' }}>
              {timeSince(s.lastHeartbeat)}
            </span>
          </div>
        ))}
      </div>
    </Shell>
  );
}

const STATUS_ORDER: Record<string, number> = { offline: 0, degraded: 1, online: 2 };

// ── Page ───────────────────────────────────────────────────────────────────────
export default function OverviewPage({ params }: { params: Promise<{ type: string }> }) {
  const { type }   = use(params);
  const [search, setSearch] = useState('');
  const [sort, setSort]     = useState<'az' | 'problems'>('az');
  const { fleet, loading: fleetLoading } = useFleet();
  const current = OVERVIEW_TYPES.find(t => t.id === type) ?? OVERVIEW_TYPES[0];

  // Build StationDashboardData from fleet API only
  const allData = fleet.map(fl => {
    const station: Station = {
      id: fl.station.id, name: fl.station.name, displayName: fl.station.displayName,
      location: '', chargerHeads: fl.station.chargerHeads,
      expectedPmPerHead: fl.station.expectedPmPerHead,
      expectedPmHead1: fl.station.expectedPmHead1 ?? fl.station.expectedPmPerHead,
      expectedPmHead2: fl.station.expectedPmHead2 ?? fl.station.expectedPmPerHead,
      fanBrand: fl.station.fanBrand,
      mqttTopics: { heartbeat: '', heartbeatPi5: '', router: '', meter: '', powerModule: '', faultStatus: '', statePlc: '', fanRPM: '', plc: '' },
      mongoCollections: { powerModule: '', meter: '', heartbeatFallingEdge: '', router: '', statePlc: '' },
      telegram: { chatId: '', botToken: '', enabled: false }, createdAt: '',
    };
    const data: StationDashboardData = {
      stationId: fl.station.id,
      heartbeats: [
        { name: 'OCPP Device', key: 'heartbeat' as const,    topic: '', lastSeen: fl.heartbeat.lastSeen || '', online: fl.heartbeat.online },
        ...(fl.station.hasPi5 !== false ? [{
          name: 'Pi5', key: 'heartbeatPi5' as const, topic: '', lastSeen: fl.pi5.lastSeen || '', online: fl.pi5.online,
        }] : []),
        { name: 'Router',      key: 'router' as const,       topic: '', lastSeen: fl.router.lastSeen || '',   online: fl.router.online, connstate: fl.router.connstate },
      ],
      routerData: {
        connstate: fl.router.connstate,
        tempRaw: fl.router.tempRaw ?? 0,
        rssi: fl.router.rssi ?? 0,
        rsrp: 0, rsrq: 0, sinr: 0,
        conntype: fl.router.conntype ?? '',
        operator: '', opernum: 0, ip: [], model: '', manuf: '', imei: '', iccid: '',
        lastSeen: fl.router.lastSeen || '', online: fl.router.online,
      },
      powerModuleHeads: fl.powerModule
        .filter(pm => pm.head <= (fl.station.chargerHeads || 2))
        .map(pm => ({
          head: pm.head, pmCount: pm.pmCount, voltage: pm.voltage, current: pm.current,
          powerKw: pm.powerKw, prevVoltage: 0, prevCurrent: 0, timestamp: pm.timestamp, online: pm.online,
        })),
      meterHistory: fl.meter.meter1Wh > 0 || fl.meter.meter2Wh > 0 ? [{
        meter1Wh: fl.meter.meter1Wh, meter2Wh: fl.meter.meter2Wh,
        timestamp1: fl.meter.timestamp1, timestamp2: fl.meter.timestamp2, timestamp: fl.meter.timestamp1,
      }] : [],
      tempHistory: [],
      fanData: { fans: {}, timestamp: '' },
      scripts: [
        { name: 'fault_status', description: 'Fault status heartbeat', mqttTopic: '', lastHeartbeat: fl.scripts?.faultStatus.lastHeartbeat || '', online: !!fl.scripts?.faultStatus.online, expectedInterval: 30 },
        { name: 'plc',          description: 'PLC data heartbeat',     mqttTopic: '', lastHeartbeat: fl.scripts?.plc.lastHeartbeat || '',         online: !!fl.scripts?.plc.online,         expectedInterval: 30 },
      ],
      plcData: {
        head1: { head: 1, chargeState: fl.plcHeads[0]?.chargeState || 'Unknown', iRessState: 0, soc: fl.plcHeads[0]?.soc || 0, targetVoltage: 0, targetCurrent: 0, presentVoltage: 0, presentCurrent: 0, powerKw: fl.plcHeads[0]?.powerKw || 0, measuredVoltage: 0, measuredCurrent: 0, temp1Head: 0, temp2Head: 0, tempPowerModule: 0, fanStatus: 0, headError: 0, errorMessage: '', cpStatus: 0, activeMld: 0, insulationFault: 0, warningInsulation: 0, maxPower: 0, maxCurrent: 0, maxVoltage: 0, icp: 0, usl: 0, dynamicMaxCurrent: 0 },
        head2: { head: 2, chargeState: fl.plcHeads[1]?.chargeState || 'Unknown', iRessState: 0, soc: fl.plcHeads[1]?.soc || 0, targetVoltage: 0, targetCurrent: 0, presentVoltage: 0, presentCurrent: 0, powerKw: fl.plcHeads[1]?.powerKw || 0, measuredVoltage: 0, measuredCurrent: 0, temp1Head: 0, temp2Head: 0, tempPowerModule: 0, fanStatus: 0, headError: 0, errorMessage: '', cpStatus: 0, activeMld: 0, insulationFault: 0, warningInsulation: 0, maxPower: 0, maxCurrent: 0, maxVoltage: 0, icp: 0, usl: 0, dynamicMaxCurrent: 0 },
        ambientTemp: 0, ambientHum: 0, ambientPressure: 0, pi5Temp: 0,
        hmiStatus: 'Unknown', plc1Status: 'Unknown', plc2Status: 'Unknown',
        lem1Status: 'Unknown', lem2Status: 'Unknown', fanStatus1_8: '0', timestamp: '',
      },
    };
    // Attach stalled meta from fleet API (used by MeterCard)
    (data as any).__meterMeta = { stalled1: fl.meter.stalled1, stalled2: fl.meter.stalled2 };
    return { station, data };
  }).sort((a, b) => a.station.id.localeCompare(b.station.id));

  // Search filter — guard against missing fields from API
  const filtered = search.trim() === ''
    ? allData
    : allData.filter(({ station }) => {
        const q = search.toLowerCase();
        return (
          (station.id          || '').toLowerCase().includes(q) ||
          (station.name        || '').toLowerCase().includes(q) ||
          (station.displayName || '').toLowerCase().includes(q) ||
          (station.location    || '').toLowerCase().includes(q)
        );
      });

  // Sort — page-specific "Problems First" criteria
  const sorted = sort === 'problems'
    ? [...filtered].sort((a, b) => {
        if (type === 'powermodule') {
          const missingA = a.data.powerModuleHeads.reduce((s, h) => {
            const exp = h.head === 1 ? (a.station.expectedPmHead1 ?? a.station.expectedPmPerHead) : (a.station.expectedPmHead2 ?? a.station.expectedPmPerHead);
            return s + Math.max(0, exp - h.pmCount);
          }, 0);
          const missingB = b.data.powerModuleHeads.reduce((s, h) => {
            const exp = h.head === 1 ? (b.station.expectedPmHead1 ?? b.station.expectedPmPerHead) : (b.station.expectedPmHead2 ?? b.station.expectedPmPerHead);
            return s + Math.max(0, exp - h.pmCount);
          }, 0);
          return missingB - missingA;  // most missing first
        }
        if (type === 'meter') {
          const headsA = a.station.chargerHeads || 2;
          const headsB = b.station.chargerHeads || 2;
          const stalledA = ((a.data as any).__meterMeta?.stalled1 ? 1 : 0) + (headsA >= 2 && (a.data as any).__meterMeta?.stalled2 ? 1 : 0);
          const stalledB = ((b.data as any).__meterMeta?.stalled1 ? 1 : 0) + (headsB >= 2 && (b.data as any).__meterMeta?.stalled2 ? 1 : 0);
          return stalledB - stalledA;  // most stalled first
        }
        if (type === 'temperature') {
          const tempA = a.data.routerData.tempRaw / 10;
          const tempB = b.data.routerData.tempRaw / 10;
          return tempB - tempA;  // hottest first
        }
        return STATUS_ORDER[deriveStatus(a.data)] - STATUS_ORDER[deriveStatus(b.data)];
      })
    : filtered;

  // Fleet totals for heartbeat
  const hbFleet = (() => {
    const main   = allData.flatMap(x => x.data.heartbeats.filter(h => h.key === 'heartbeat'));
    const pi5    = allData.flatMap(x => x.data.heartbeats.filter(h => h.key === 'heartbeatPi5'));
    const router = allData.flatMap(x => x.data.heartbeats.filter(h => h.key === 'router'));
    return {
      mainOnline:   main.filter(h => h.online).length,     mainTotal:   main.length,
      pi5Online:    pi5.filter(h => h.online).length,      pi5Total:    pi5.length,
      routerOnline: router.filter(h => h.online).length,   routerTotal: router.length,
    };
  })();

  // Summary stats per type (computed from all data, not filtered)
  const stats = (() => {
    if (type === 'heartbeat') {
      return [
        { label: 'OCPP Device Online', value: `${hbFleet.mainOnline}/${hbFleet.mainTotal}`,     color: hbFleet.mainOnline   === hbFleet.mainTotal   ? 'var(--ok)' : 'var(--error)' },
        { label: 'Pi5 Online',         value: `${hbFleet.pi5Online}/${hbFleet.pi5Total}`,       color: hbFleet.pi5Online    === hbFleet.pi5Total    ? 'var(--ok)' : 'var(--error)' },
        { label: 'Router Online',      value: `${hbFleet.routerOnline}/${hbFleet.routerTotal}`, color: hbFleet.routerOnline === hbFleet.routerTotal ? 'var(--ok)' : 'var(--error)' },
      ];
    }
    if (type === 'powermodule') {
      const expFor = (st: Station, head: number) =>
        head === 1 ? (st.expectedPmHead1 ?? st.expectedPmPerHead)
                   : (st.expectedPmHead2 ?? st.expectedPmPerHead);

      const normalSt = allData.filter(x =>
        x.data.powerModuleHeads.some(h => h.online) &&
        x.data.powerModuleHeads.filter(h => h.online).every(h => h.pmCount >= expFor(x.station, h.head))
      ).length;
      const offlinePmCount = allData.reduce((total, x) => {
        return total + x.data.powerModuleHeads.reduce((sum, h) => {
          const exp = expFor(x.station, h.head);
          if (!h.online) return sum + exp;
          return sum + Math.max(0, exp - h.pmCount);
        }, 0);
      }, 0);
      const offlineSt = allData.filter(x => x.data.powerModuleHeads.every(h => !h.online)).length;
      return [
        { label: 'Normal Stations',      value: `${normalSt}/${allData.length}`, color: normalSt === allData.length - offlineSt ? 'var(--ok)' : 'var(--warn)' },
        { label: 'Offline Power Module', value: offlinePmCount,                  color: offlinePmCount > 0 ? 'var(--error)' : 'var(--text-muted)' },
        { label: 'Station Offline',      value: offlineSt,                       color: offlineSt > 0 ? 'var(--error)' : 'var(--text-muted)' },
      ];
    }
    if (type === 'meter') {
      // Total meters = sum of chargerHeads across stations (1-head stations contribute 1, 2-head contribute 2)
      const totalMeters = allData.reduce((s, x) => s + (x.station.chargerHeads || 2), 0);
      const stalled1 = allData.filter(x => (x.data as any).__meterMeta?.stalled1).length;
      const stalled2 = allData.filter(x => (x.station.chargerHeads || 2) >= 2 && (x.data as any).__meterMeta?.stalled2).length;
      const stalledTotal = stalled1 + stalled2;
      return [
        { label: 'Total Meters', value: `${totalMeters}`,           color: 'var(--text-primary)' },
        { label: 'Active',       value: totalMeters - stalledTotal, color: 'var(--ok)' },
        { label: 'Stalled',      value: stalledTotal,               color: stalledTotal > 0 ? 'var(--error)' : 'var(--text-muted)' },
      ];
    }
    if (type === 'temperature') {
      const temps = allData.map(x => x.data.routerData.online ? x.data.routerData.tempRaw / 10 : 0);
      const max   = Math.max(...temps);
      return [
        { label: 'Avg Temp', value: `${(temps.reduce((a, b) => a + b, 0) / Math.max(temps.length, 1)).toFixed(1)} °C`, color: 'var(--text-primary)' },
        { label: 'Max Temp', value: `${max.toFixed(1)} °C`, color: max >= 80 ? 'var(--error)' : 'var(--ok)' },
        { label: 'Alerts',   value: temps.filter(t => t >= 80).length, color: 'var(--error)' },
      ];
    }
    if (type === 'fanrpm') {
      const allFans   = allData.flatMap(x => Object.values(x.data.fanData.fans));
      const idleCnt   = allFans.filter(r => r === 0).length;
      const runCnt    = allFans.length - idleCnt;
      return [
        { label: 'Total Fans',   value: allFans.length,  color: 'var(--text-primary)' },
        { label: 'Idle (0 RPM)', value: idleCnt,         color: idleCnt > 0 ? 'var(--text-secondary)' : 'var(--text-muted)' },
        { label: 'Running',      value: runCnt,          color: runCnt > 0 ? 'var(--ok)' : 'var(--text-muted)' },
      ];
    }
    if (type === 'scripts') {
      const all = allData.flatMap(x => x.data.scripts);
      return [
        { label: 'Total Scripts', value: all.length,                       color: 'var(--text-primary)' },
        { label: 'Running',       value: all.filter(s => s.online).length,  color: 'var(--ok)'   },
        { label: 'Stopped',       value: all.filter(s => !s.online).length, color: 'var(--error)' },
      ];
    }
    return [];
  })();

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '1.25rem', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 className="section-title" style={{ fontSize: 18 }}>
            {current.label} — All Stations
          </h1>
          <p className="section-subtitle">
            {allData.length} stations
            {filtered.length !== allData.length && ` · ${filtered.length} shown`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Sort toggle */}
          <div style={{ display: 'flex', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
            <button
              onClick={() => setSort('az')}
              style={{
                padding: '5px 12px', fontSize: 11, fontFamily: 'var(--font-geist-mono), monospace',
                cursor: 'pointer', border: 'none',
                background: sort === 'az' ? 'var(--info-bg)' : 'transparent',
                color: sort === 'az' ? 'var(--info-text)' : 'var(--text-secondary)',
                fontWeight: sort === 'az' ? 600 : 400,
                borderRight: '1px solid var(--border)',
              }}
            >
              A-Z
            </button>
            <button
              onClick={() => setSort('problems')}
              style={{
                padding: '5px 12px', fontSize: 11, fontFamily: 'var(--font-geist-mono), monospace',
                cursor: 'pointer', border: 'none',
                background: sort === 'problems' ? 'var(--error-bg)' : 'transparent',
                color: sort === 'problems' ? 'var(--error-text)' : 'var(--text-secondary)',
                fontWeight: sort === 'problems' ? 600 : 400,
              }}
            >
              Problems First
            </button>
          </div>
          {/* Search */}
          <input
            type="text"
            className="input"
            placeholder="Search stations..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: 200, fontSize: 12 }}
          />
        </div>
      </div>

      {/* Type switcher tabs */}
      <div className="tabs" style={{ marginBottom: '1.25rem' }}>
        {OVERVIEW_TYPES.map(t => (
          <Link key={t.id} href={`/overview/${t.id}`} style={{ textDecoration: 'none' }}>
            <button className={`tab ${type === t.id ? 'tab-active' : ''}`}>
              {t.label}
            </button>
          </Link>
        ))}
      </div>

      {/* Stats */}
      {stats.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
          {stats.map(s => (
            <div key={s.label} className="card" style={{ padding: '0.875rem' }}>
              <div className="stat-value" style={{ color: s.color, fontSize: 22 }}>{s.value}</div>
              <div className="stat-label">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* No results — only show when not loading */}
      {sorted.length === 0 && !fleetLoading && (
        <div className="card" style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
          {search.trim() ? `No stations match "${search}"` : 'No stations configured. Add one in Config.'}
        </div>
      )}

      {/* Cards grid */}
      <div className="overview-grid">
        {sorted.map(({ station, data }) => {
          if (type === 'heartbeat')   return <HeartbeatCard    key={station.id} station={station} data={data} />;
          if (type === 'powermodule') return <PowerModuleCard  key={station.id} station={station} data={data} />;
          if (type === 'meter')       return <MeterCard        key={station.id} station={station} data={data} />;
          if (type === 'temperature') return <TemperatureCard  key={station.id} station={station} data={data} />;
          if (type === 'fanrpm')      return <FanRPMCard       key={station.id} station={station} data={data} />;
          if (type === 'scripts')     return <ScriptsCard      key={station.id} station={station} data={data} />;
          return null;
        })}
      </div>
    </div>
  );
}
