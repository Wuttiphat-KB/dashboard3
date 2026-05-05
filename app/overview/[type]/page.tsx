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

function Shell({ station, data, children }: { station: Station; data: StationDashboardData; children: React.ReactNode }) {
  const st = deriveStatus(data);
  return (
    <div className="card" style={{
      borderColor: st === 'offline' ? 'var(--error)' : st === 'degraded' ? 'var(--warn)' : 'var(--border)',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{station.displayName}</div>
        </div>
        <StatusBadge status={st} />
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
function PowerModuleCard({ station, data }: { station: Station; data: StationDashboardData }) {
  const plcHeads = [data.plcData.head1, data.plcData.head2];
  return (
    <Shell station={station} data={data}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {data.powerModuleHeads.map(h => {
          const ok     = h.online && h.pmCount > 0;
          const color  = ok ? 'var(--ok)' : 'var(--error)';
          const bg     = ok ? 'var(--ok-bg)' : 'var(--error-bg)';
          const border = ok ? 'transparent' : 'var(--error)';
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
                    {h.online ? h.pmCount : '—'}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>PM</span>
                </div>
              </div>
              {plc && (
                <div style={{ marginBottom: 6 }}>
                  <ChargeStateBadge state={plc.chargeState} powerKw={plc.powerKw} soc={plc.soc} />
                </div>
              )}
              <div style={{ fontSize: 11, fontFamily: 'monospace', color: ok ? 'var(--text-muted)' : 'var(--error-text)' }}>
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
function MeterCard({ station, data }: { station: Station; data: StationDashboardData }) {
  const led1   = getMeterLed(data.meterHistory, 1);
  const led2   = getMeterLed(data.meterHistory, 2);
  const latest = data.meterHistory[data.meterHistory.length - 1];
  const toKwh  = (wh: number) => (wh / 1000).toFixed(1);

  const meters = [
    { n: '1', led: led1, val: latest?.meter1Wh ?? 0, ts: latest?.timestamp1 ?? '' },
    { n: '2', led: led2, val: latest?.meter2Wh ?? 0, ts: latest?.timestamp2 ?? '' },
  ];

  return (
    <Shell station={station} data={data}>
      {meters.map(({ n, led, val, ts }) => {
        const pct = Math.min((val / 1000 / METER_MAX_KWH) * 100, 100);
        return (
          <div key={n} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <div style={{
                  width: 14, height: 14, borderRadius: '50%',
                  background: led === 'ok' ? 'var(--ok)' : 'var(--error)',
                  boxShadow: led === 'ok' ? '0 0 8px var(--ok)' : '0 0 8px var(--error)',
                  animation: led === 'ok' ? 'pulse-led 2s ease-in-out infinite' : 'none',
                }} />
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Meter {n} (Head {n})</span>
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{toKwh(val)} kWh</span>
            </div>
            <div style={{ height: 7, background: 'var(--bg-elevated)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: led === 'ok' ? 'var(--ok)' : 'var(--error)', borderRadius: 4, transition: 'width 0.4s' }} />
            </div>
            {ts && (
              <div style={{ fontSize: 9, fontFamily: 'monospace', color: led === 'error' ? 'var(--error-text)' : 'var(--text-muted)' }}>
                {led === 'error' ? 'Stalled · ' : ''}Last: {fmtTs(ts)} · {timeSince(ts)}
              </div>
            )}
          </div>
        );
      })}
    </Shell>
  );
}

// ── Temperature ───────────────────────────────────────────────────────────────
function TemperatureCard({ station, data }: { station: Station; data: StationDashboardData }) {
  const THRESH  = 80;
  const current = data.routerData.tempRaw / 10;
  const isAlert = current >= THRESH;
  const isWarn  = current >= THRESH - 10;
  const color   = isAlert ? 'var(--error)' : isWarn ? 'var(--warn)' : 'var(--ok)';
  const pct     = Math.min((current / 120) * 100, 100);

  return (
    <Shell station={station} data={data}>
      {isAlert && (
        <div style={{ padding: '5px 8px', background: 'var(--error-bg)', borderRadius: 4, fontSize: 10, color: 'var(--error-text)', borderLeft: '3px solid var(--error)' }}>
          Telegram alert triggered — {current.toFixed(1)} °C
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <svg width="68" height="68" viewBox="0 0 68 68">
            <circle cx="34" cy="34" r="28" fill="none" stroke="var(--bg-elevated)" strokeWidth="6" />
            <circle cx="34" cy="34" r="28" fill="none" stroke={color} strokeWidth="6"
              strokeDasharray={`${(pct / 100) * 2 * Math.PI * 28} ${2 * Math.PI * 28}`}
              strokeLinecap="round" transform="rotate(-90 34 34)" />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 14, fontWeight: 800, color, lineHeight: 1 }}>{data.routerData.online ? current.toFixed(0) : '—'}</span>
            <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>°C</span>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
            {[
              { label: 'Temp',      value: data.routerData.online ? `${current.toFixed(1)} °C` : '—', color },
              { label: 'Threshold', value: `${THRESH} °C`,    color: 'var(--text-muted)' },
              { label: 'RSSI',      value: `${data.routerData.rssi} dBm`, color: 'var(--text-secondary)' },
              { label: 'Conn',      value: data.routerData.conntype,       color: 'var(--info-text)' },
            ].map(s => (
              <div key={s.label} style={{ background: 'var(--bg-elevated)', borderRadius: 4, padding: '5px 7px' }}>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{s.label}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--text-muted)' }}>
        Last: {fmtTs(data.routerData.lastSeen)} · {timeSince(data.routerData.lastSeen)}
      </div>
      <span className={`badge ${isAlert ? 'badge-error' : isWarn ? 'badge-warn' : 'badge-ok'}`} style={{ alignSelf: 'flex-start' }}>
        <span className={`led ${isAlert ? 'led-error' : isWarn ? 'led-warn led-pulse' : 'led-ok led-pulse'}`} />
        {isAlert ? 'CRITICAL' : isWarn ? 'WARNING' : 'NORMAL'}
      </span>
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
  const plcHeads = [data.plcData.head1, data.plcData.head2];

  return (
    <Shell station={station} data={data}>
      {/* Charge state per head */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 2 }}>
        {plcHeads.map(p => (
          <div key={p.head} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', width: 20, flexShrink: 0 }}>H{p.head}</span>
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
        { name: 'OCPP Device', key: 'heartbeat',    topic: '', lastSeen: fl.heartbeat.lastSeen || '', online: fl.heartbeat.online },
        { name: 'Pi5',         key: 'heartbeatPi5', topic: '', lastSeen: fl.pi5.lastSeen || '',       online: fl.pi5.online },
        { name: 'Router',      key: 'router',       topic: '', lastSeen: fl.router.lastSeen || '',   online: fl.router.online, connstate: fl.router.connstate },
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
      powerModuleHeads: fl.powerModule.map(pm => ({
        head: pm.head, pmCount: pm.pmCount, voltage: pm.voltage, current: pm.current,
        powerKw: pm.powerKw, prevVoltage: 0, prevCurrent: 0, timestamp: pm.timestamp, online: pm.online,
      })),
      meterHistory: fl.meter.meter1Wh > 0 ? [{
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
    return { station, data };
  }).sort((a, b) => a.station.id.localeCompare(b.station.id));

  // Search filter
  const filtered = search.trim() === ''
    ? allData
    : allData.filter(({ station }) => {
        const q = search.toLowerCase();
        return (
          station.id.toLowerCase().includes(q) ||
          station.name.toLowerCase().includes(q) ||
          station.displayName.toLowerCase().includes(q) ||
          station.location.toLowerCase().includes(q)
        );
      });

  // Sort
  const sorted = sort === 'problems'
    ? [...filtered].sort((a, b) =>
        STATUS_ORDER[deriveStatus(a.data)] - STATUS_ORDER[deriveStatus(b.data)]
      )
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
      const totalMeters = allData.length * 2;
      const stalled1 = allData.filter(x => getMeterLed(x.data.meterHistory, 1) === 'error').length;
      const stalled2 = allData.filter(x => getMeterLed(x.data.meterHistory, 2) === 'error').length;
      const stalledTotal = stalled1 + stalled2;
      return [
        { label: 'Total Meters',   value: `${totalMeters}`,               color: 'var(--text-primary)' },
        { label: 'Active (green)', value: totalMeters - stalledTotal,      color: 'var(--ok)' },
        { label: 'Stalled (red)',  value: stalledTotal,                    color: stalledTotal > 0 ? 'var(--error)' : 'var(--text-muted)' },
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
