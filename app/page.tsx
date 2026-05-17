'use client';

import { useState, useMemo } from 'react';
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
  const hasPi5    = station.hasPi5 !== false;
  const numHeads  = station.chargerHeads || 2;
  const visiblePlcHeads = plcHeads.filter(h => h.head <= numHeads);
  const visiblePmHeads  = powerModule.filter(h => h.head <= numHeads);
  const hbDevices = hasPi5 ? [heartbeat.online, pi5.online, router.online] : [heartbeat.online, router.online];
  const hbOnline  = hbDevices.filter(Boolean).length;
  const hbTotal   = hbDevices.length;
  const pmTotal   = visiblePmHeads.reduce((s, h) => s + (h.online ? h.pmCount : 0), 0);

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
          {visiblePlcHeads.map(p => {
            const isCharging = p.chargeState === 'Charging';
            const isFault    = p.chargeState === 'Fault';
            return (
              <div key={p.head} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
                {numHeads > 1 && (
                  <span style={{ fontWeight: 700, color: 'var(--text-secondary)', width: 20, flexShrink: 0 }}>H{p.head}</span>
                )}
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
            { label: 'OCPP', online: heartbeat.online, show: true },
            { label: 'Pi5',  online: pi5.online,       show: hasPi5 },
            { label: 'Router', online: router.online,  show: true },
          ].filter(d => d.show).map(d => (
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

const STATUS_ORDER: Record<string, number> = { offline: 0, degraded: 1, online: 2 };

export default function FleetOverview() {
  const { fleet, loading, error } = useFleet();
  const [search, setSearch] = useState('');
  const [sort, setSort]     = useState<'az' | 'problems'>('az');

  const onlineCount   = fleet.filter(f => f.status === 'online').length;
  const degradedCount = fleet.filter(f => f.status === 'degraded').length;
  const offlineCount  = fleet.filter(f => f.status === 'offline').length;

  // Filter by search query — match against id, name, displayName
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return fleet;
    return fleet.filter(({ station }) => (
      (station.id          || '').toLowerCase().includes(q) ||
      (station.name        || '').toLowerCase().includes(q) ||
      (station.displayName || '').toLowerCase().includes(q)
    ));
  }, [fleet, search]);

  // Sort: A-Z by displayName, or Problems First (offline → degraded → online)
  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sort === 'az') {
      arr.sort((a, b) => (a.station.displayName || a.station.id).localeCompare(b.station.displayName || b.station.id));
    } else {
      arr.sort((a, b) => {
        const d = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
        if (d !== 0) return d;
        return (a.station.displayName || a.station.id).localeCompare(b.station.displayName || b.station.id);
      });
    }
    return arr;
  }, [filtered, sort]);

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '1.25rem', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 className="section-title" style={{ fontSize: 18 }}>Overview</h1>
          <p className="section-subtitle">
            {loading ? 'Loading stations...' : `${fleet.length} stations`}
            {filtered.length !== fleet.length && ` · ${filtered.length} shown`}
            {error && <span style={{ color: 'var(--error-text)' }}> · API error: {error}</span>}
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
            style={{ width: 220, fontSize: 12 }}
          />
        </div>
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

      {/* No results */}
      {!loading && sorted.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
          {search.trim() ? `No stations match "${search}"` : 'No stations configured.'}
        </div>
      )}

      {/* Station grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>
        {sorted.map(item => (
          <StationCard key={item.station.id} item={item} />
        ))}
      </div>
    </div>
  );
}
