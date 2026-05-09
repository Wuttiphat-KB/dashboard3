'use client';

import { useState } from 'react';
import Link from 'next/link';
import { use } from 'react';
import { useStations, useDashboard } from '@/lib/hooks/useStations';
import HeartbeatPanel   from '@/components/HeartbeatPanel';
import PowerModulePanel from '@/components/PowerModulePanel';
import MeterPanel       from '@/components/MeterPanel';
import TempPanel        from '@/components/TempPanel';
import FanRPMPanel      from '@/components/FanRPMPanel';
import MqttScriptPanel  from '@/components/MqttScriptPanel';
import PlcPanel         from '@/components/PlcPanel';
const TABS = [
  { id: 'heartbeat',   label: '♡  Heartbeat'     },
  { id: 'powermodule', label: '⚡ Power Module'   },
  { id: 'meter',       label: '▣  Meter'          },
  { id: 'temperature', label: '◉  Temperature'    },
  { id: 'fanrpm',      label: '◎  Fan RPM'        },
  { id: 'scripts',     label: '◈  MQTT Scripts'   },
  { id: 'plc',         label: '▤  PLC'            },
];

export default function StationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id }      = use(params);
  const [tab, setTab] = useState('heartbeat');

  const { stations } = useStations();
  const { data, loading: dashLoading } = useDashboard(id);

  const station = stations.find(s => s.id === id || s.name === id);
  const status  = data ? (
    data.heartbeats.every(h => h.online) ? 'online'
    : data.heartbeats.every(h => !h.online) ? 'offline'
    : 'degraded'
  ) as 'online' | 'degraded' | 'offline' : 'offline';

  if (dashLoading) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
        Loading station data...
      </div>
    );
  }

  if (!station || !data) {
    return (
      <div>
        <Link href="/" style={{ fontSize: 12, color: 'var(--info-text)', textDecoration: 'none' }}>← Fleet Overview</Link>
        <div className="card" style={{ marginTop: '1rem', textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          Station &quot;{id}&quot; not found. <Link href="/config" style={{ color: 'var(--info-text)' }}>Add in Config</Link>
        </div>
      </div>
    );
  }

  const statusMap = {
    online:   { badge: 'badge-ok',    led: 'led-ok led-pulse'   },
    degraded: { badge: 'badge-warn',  led: 'led-warn led-pulse'  },
    offline:  { badge: 'badge-error', led: 'led-error'           },
  };
  const { badge, led } = statusMap[status];

  const latest  = data.meterHistory[data.meterHistory.length - 1];
  const pmTotal = data.powerModuleHeads.reduce((s, h) => s + (h.online ? h.pmCount : 0), 0);
  const pmPower = data.powerModuleHeads.reduce((s, h) => s + (h.online ? h.powerKw : 0), 0);
  const fanCount = Object.values(data.fanData.fans).filter(r => r > 0).length;
  const fanTotal = Object.keys(data.fanData.fans).length;

  return (
    <div>
      {/* Breadcrumb */}
      <div style={{ marginBottom: '1rem', fontSize: 11, color: 'var(--text-muted)' }}>
        <Link href="/" style={{ color: 'var(--info-text)', textDecoration: 'none' }}>Fleet Overview</Link>
        <span style={{ margin: '0 6px' }}>›</span>
        <span>{station.displayName}</span>
      </div>

      {/* Station header */}
      <div className="card" style={{ marginBottom: '1.5rem', padding: '1rem 1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>{station.displayName}</h1>
              <span className={`badge ${badge}`}>
                <span className={`led ${led}`} />
                {status.toUpperCase()}
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              {station.chargerHeads} charger head{station.chargerHeads > 1 ? 's' : ''} · Router: {data.routerData.connstate}
            </div>
          </div>
          <Link href={`/config?edit=${station.id}`} className="btn btn-secondary btn-sm">◧ Config</Link>
        </div>

        {/* Quick stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8, marginTop: 16 }}>
          {[
            {
              label: 'Heartbeats',
              value: `${data.heartbeats.filter(h => h.online).length}/${data.heartbeats.length}`,
              ok: data.heartbeats.every(h => h.online),
            },
            {
              label: 'Active PM',
              value: `${pmTotal} modules`,
              ok: pmTotal > 0 || status === 'offline',
            },
            {
              label: 'Total Power',
              value: `${pmPower.toFixed(1)} kW`,
              ok: true,
            },
            {
              label: station.chargerHeads >= 2 ? 'Meter 1' : 'Meter',
              value: latest ? `${(latest.meter1Wh / 1000).toFixed(0)} kWh` : '—',
              ok: true,
            },
            ...(station.chargerHeads >= 2 ? [{
              label: 'Meter 2',
              value: latest ? `${(latest.meter2Wh / 1000).toFixed(0)} kWh` : '—',
              ok: true,
            }] : []),
            {
              label: 'Fans',
              value: `${fanCount}/${fanTotal}`,
              ok: fanCount === fanTotal,
            },
            {
              label: 'Scripts',
              value: `${data.scripts.filter(s => s.online).length}/${data.scripts.length}`,
              ok: data.scripts.every(s => s.online),
            },
            {
              label: 'Router Temp',
              value: data.routerData.online ? `${(data.routerData.tempRaw / 10).toFixed(1)} °C` : '—',
              ok: (data.routerData.tempRaw / 10) < 80,
            },
          ].map(m => (
            <div key={m.label} style={{ background: 'var(--bg-elevated)', borderRadius: 6, padding: '8px 10px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: m.ok ? 'var(--text-primary)' : 'var(--warn-text)' }}>
                {m.value}
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 2 }}>
                {m.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        {TABS.map(t => (
          <button key={t.id} className={`tab ${tab === t.id ? 'tab-active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Panel content */}
      <div style={{ paddingTop: '0.5rem' }}>
        {tab === 'heartbeat'   && <HeartbeatPanel   heartbeats={data.heartbeats} />}
        {tab === 'powermodule' && <PowerModulePanel  heads={data.powerModuleHeads} stationId={station.id}
          expectedPmHead1={station.expectedPmHead1 ?? station.expectedPmPerHead}
          expectedPmHead2={station.expectedPmHead2 ?? station.expectedPmPerHead}
          plcData={data.plcData} />}
        {tab === 'meter'       && <MeterPanel        history={data.meterHistory}   stationId={station.id} chargerHeads={station.chargerHeads} />}
        {tab === 'temperature' && <TempPanel         routerData={data.routerData}  tempHistory={data.tempHistory} stationId={station.id} />}
        {tab === 'fanrpm'      && <FanRPMPanel       fanData={data.fanData}        stationId={station.id} />}
        {tab === 'scripts'     && <MqttScriptPanel   scripts={data.scripts}        stationId={station.id} />}
        {tab === 'plc'         && <PlcPanel          plcData={data.plcData}        stationId={station.id} chargerHeads={station.chargerHeads} />}
      </div>
    </div>
  );
}
