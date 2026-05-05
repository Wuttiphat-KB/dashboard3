'use client';

import Link from 'next/link';
import { useFleet, FleetStation } from '@/lib/hooks/useFleet';

function StatusDot({ status }: { status: 'online' | 'degraded' | 'offline' }) {
  const map = {
    online:   { badge: 'badge-ok',    led: 'led-ok led-pulse'  },
    degraded: { badge: 'badge-warn',  led: 'led-warn led-pulse' },
    offline:  { badge: 'badge-error', led: 'led-error'          },
  };
  const { badge, led } = map[status];
  return (
    <span className={`badge ${badge}`}>
      <span className={`led ${led}`} />
      {status.toUpperCase()}
    </span>
  );
}

function StationCard({ item }: { item: FleetStation }) {
  const { station, status, heartbeat, pi5, router, powerModule, plcHeads } = item;
  const hbOnline  = [heartbeat.online, pi5.online, router.online].filter(Boolean).length;
  const hbTotal   = 3;
  const pmTotal   = powerModule.reduce((s, h) => s + (h.online ? h.pmCount : 0), 0);

  return (
    <Link href={`/station/${station.id}`} style={{ textDecoration: 'none' }}>
      <div
        className="card"
        style={{
          cursor: 'pointer',
          borderColor: status === 'offline' ? 'var(--error)' : status === 'degraded' ? 'var(--warn)' : 'var(--border)',
          transition: 'transform 0.1s ease',
        }}
        onMouseEnter={e => (e.currentTarget.style.transform = 'translateY(-2px)')}
        onMouseLeave={e => (e.currentTarget.style.transform = 'translateY(0)')}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{station.displayName}</div>
          <StatusDot status={status} />
        </div>

        {/* Metrics */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, marginBottom: 10 }}>
          {[
            { label: 'Heartbeats', value: `${hbOnline}/${hbTotal}`, ok: hbOnline === hbTotal },
            { label: 'Active PM',  value: `${pmTotal} mod`,          ok: pmTotal > 0 || status === 'offline' },
          ].map(m => (
            <div key={m.label} style={{ background: 'var(--bg-elevated)', borderRadius: 6, padding: '6px 8px', textAlign: 'center' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: m.ok ? 'var(--text-primary)' : 'var(--warn-text)' }}>
                {m.value}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', marginTop: 2 }}>{m.label}</div>
            </div>
          ))}
        </div>

        {/* Charge state per head */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 10 }}>
          {plcHeads.map(p => {
            const isCharging = p.chargeState === 'Charging';
            const isFault    = p.chargeState === 'Fault';
            return (
              <div key={p.head} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
                <span style={{ fontWeight: 700, color: 'var(--text-secondary)', width: 20, flexShrink: 0 }}>H{p.head}</span>
                <span className={`badge ${isCharging ? 'badge-warn' : isFault ? 'badge-error' : 'badge-offline'}`}>
                  <span className={`led ${isCharging ? 'led-warn led-pulse' : isFault ? 'led-error' : ''}`} />
                  {p.chargeState}
                </span>
                {isCharging && (
                  <span style={{ fontWeight: 700, fontFamily: 'monospace', color: 'var(--warn-text)', fontSize: 11 }}>
                    {p.powerKw} kW · SOC {p.soc}%
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Device LEDs */}
        <div style={{ display: 'flex', gap: 5, marginBottom: 10, flexWrap: 'wrap' }}>
          {[
            { label: 'OCPP', online: heartbeat.online },
            { label: 'Pi5',  online: pi5.online },
            { label: 'Router', online: router.online },
          ].map(d => (
            <span key={d.label} style={{
              display: 'flex', alignItems: 'center', gap: 4,
              fontSize: 11, color: 'var(--text-secondary)',
              background: 'var(--bg-elevated)', borderRadius: 4, padding: '2px 7px',
            }}>
              <span className={`led ${d.online ? 'led-ok' : 'led-error'}`} style={{ width: 6, height: 6 }} />
              {d.label}
            </span>
          ))}
        </div>

        <div style={{ marginTop: 4, fontSize: 11, color: 'var(--info-text)', textAlign: 'right' }}>
          View details →
        </div>
      </div>
    </Link>
  );
}

export default function FleetOverview() {
  const { fleet, loading, error } = useFleet();

  const onlineCount   = fleet.filter(f => f.status === 'online').length;
  const degradedCount = fleet.filter(f => f.status === 'degraded').length;
  const offlineCount  = fleet.filter(f => f.status === 'offline').length;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 className="section-title" style={{ fontSize: 18 }}>Fleet Overview</h1>
        <p className="section-subtitle">
          {loading ? 'Loading stations...' : `${fleet.length} stations`}
          {error && <span style={{ color: 'var(--error-text)' }}> · API error: {error}</span>}
        </p>
      </div>

      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
        {[
          { label: 'Total Stations', value: fleet.length,    color: 'var(--info)'  },
          { label: 'Online',         value: onlineCount,     color: 'var(--ok)'    },
          { label: 'Degraded',       value: degradedCount,   color: 'var(--warn)'  },
          { label: 'Offline',        value: offlineCount,    color: 'var(--error)' },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '0.875rem 1rem' }}>
            <div className="stat-value" style={{ color: s.color, fontSize: 24 }}>{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {loading && (
        <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          Loading fleet data from MongoDB...
        </div>
      )}

      {/* Station grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>
        {fleet.map(item => (
          <StationCard key={item.station.id} item={item} />
        ))}
      </div>
    </div>
  );
}
