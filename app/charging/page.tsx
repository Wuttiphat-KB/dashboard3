'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useCharging } from '@/lib/hooks/useCharging';
import {
  classifyState, hasSession, headFlags, stationHas, stationKw, summarizeStations,
  type ChargingHead, type ChargingStation,
} from '@/lib/charging';
import { StateBadge, fmtKw, socColor } from '@/components/charging/chargingUi';
import { fmtTime, timeSince } from '@/lib/formatTime';

type Filter = 'all' | 'charging' | 'available' | 'attention';
type Sort = 'power' | 'az';

// Everything on this page is per cabinet: a card always shows all of its heads,
// and filters / counts match a cabinet when any of its heads does.
const FILTERS: { id: Filter; label: string; match: (s: ChargingStation) => boolean }[] = [
  { id: 'all',       label: 'All',       match: () => true },
  { id: 'charging',  label: 'Charging',  match: s => stationHas(s, 'charging') },
  { id: 'available', label: 'Available', match: s => stationHas(s, 'ready') },
  { id: 'attention', label: 'Attention', match: s => stationHas(s, 'fault', 'offline', 'unknown') },
];

const STATUS_BADGE = {
  online:   { badge: 'badge-ok',    led: 'led-ok led-pulse'   },
  degraded: { badge: 'badge-warn',  led: 'led-warn led-pulse' },
  offline:  { badge: 'badge-error', led: 'led-error'          },
};

const byName = (a: ChargingStation, b: ChargingStation) =>
  a.station.displayName.localeCompare(b.station.displayName, undefined, { sensitivity: 'base', numeric: true });

function Segmented<T extends string>({ value, options, onChange }: {
  value: T; options: { id: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: 'flex', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
      {options.map((o, i) => (
        <button key={o.id} onClick={() => onChange(o.id)} style={{
          padding: '5px 12px', fontSize: 11, fontFamily: 'var(--font-geist-mono), monospace', cursor: 'pointer', border: 'none',
          borderRight: i < options.length - 1 ? '1px solid var(--border)' : 'none',
          background: value === o.id ? 'var(--info-bg)' : 'transparent',
          color: value === o.id ? 'var(--info-text)' : 'var(--text-secondary)',
          fontWeight: value === o.id ? 600 : 400,
        }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function HeadBlock({ h, single }: { h: ChargingHead; single: boolean }) {
  const cls      = classifyState(h.state);
  const session  = hasSession(cls);
  const charging = cls === 'charging';
  const flags    = headFlags(h);
  // Before the vehicle reports it (PreCharge, Connected) SOC is 0 — show a dash, not "0%".
  const socKnown = charging || h.soc > 0;
  const showElectrical = session && (h.voltage > 0 || h.current > 0);

  return (
    <div style={{ padding: '8px 10px', borderRadius: 6, background: charging ? 'var(--warn-bg)' : 'var(--bg-elevated)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {!single && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', width: 20, flexShrink: 0 }}>H{h.head}</span>}
        <StateBadge state={h.state} />
        <span style={{
          marginLeft: 'auto', fontFamily: 'monospace', fontWeight: 800, fontSize: 15,
          color: charging ? 'var(--warn-text)' : 'var(--text-muted)',
        }}>
          {session && (charging || h.powerKw > 0) ? `${fmtKw(h.powerKw)} kW` : '—'}
        </span>
      </div>

      {session && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <div style={{ flex: 1, height: 8, background: 'var(--bg-base)', borderRadius: 4, overflow: 'hidden' }}>
            {socKnown && (
              <div style={{ width: `${Math.min(Math.max(h.soc, 0), 100)}%`, height: '100%', background: socColor(h.soc), borderRadius: 4, transition: 'width 0.4s ease' }} />
            )}
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'monospace', color: 'var(--text-primary)', minWidth: 64, textAlign: 'right' }}>
            SOC {socKnown ? `${h.soc}%` : '—'}
          </span>
        </div>
      )}

      {showElectrical && (
        <div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: 5, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <span title={`requested ${h.targetVoltage} V · ${h.targetCurrent} A`}>{h.voltage} V · {h.current} A</span>
          {h.maxPowerKw > 0 && <span>max {fmtKw(h.maxPowerKw)} kW</span>}
          {h.cableTempC > 0 && <span>cable {h.cableTempC} °C</span>}
        </div>
      )}

      {flags.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
          {flags.map(f => (
            <span key={f.label} className={`badge ${f.tone === 'error' ? 'badge-error' : 'badge-info'}`} style={{ fontSize: 10 }}>{f.label}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function StationCard({ s }: { s: ChargingStation }) {
  const kw = stationKw(s);
  const badge = STATUS_BADGE[s.status];
  return (
    <div className="card" style={{
      display: 'flex', flexDirection: 'column', gap: 8,
      borderColor: s.status === 'offline' ? 'var(--error)' : s.status === 'degraded' ? 'var(--warn)' : 'var(--border)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {s.station.displayName}
        </span>
        {kw > 0 && (
          <span style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 700, color: 'var(--warn-text)', flexShrink: 0 }}>{fmtKw(kw)} kW</span>
        )}
        <span className={`badge ${badge.badge}`} style={{ marginLeft: 'auto', flexShrink: 0 }}>
          <span className={`led ${badge.led}`} />
          {s.status.toUpperCase()}
        </span>
      </div>

      {s.heads.map(h => <HeadBlock key={h.head} h={h} single={s.heads.length === 1} />)}

      {!s.live && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          No live PLC data{s.updatedAt ? ` · last update ${timeSince(s.updatedAt)}` : ''}
        </div>
      )}

      <Link href={`/station/${s.station.id}`} style={{ fontSize: 12, color: 'var(--info-text)', textDecoration: 'none', textAlign: 'right', marginTop: 'auto' }}>
        View station →
      </Link>
    </div>
  );
}

export default function ChargingPage() {
  const { stations, loading, error, fetchedAt } = useCharging();
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort]     = useState<Sort>('power');
  const [search, setSearch] = useState('');

  const sum = useMemo(() => summarizeStations(stations), [stations]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const match = FILTERS.find(f => f.id === filter)!.match;
    return stations
      .filter(s => !q
        || s.station.displayName.toLowerCase().includes(q)
        || s.station.id.toLowerCase().includes(q)
        || s.station.name.toLowerCase().includes(q))
      .filter(match)
      .sort((a, b) => sort === 'power' ? (stationKw(b) - stationKw(a)) || byName(a, b) : byName(a, b));
  }, [stations, filter, sort, search]);

  const filterOptions = FILTERS.map(f => ({
    id: f.id,
    label: f.id === 'all' ? f.label : `${f.label} ${stations.filter(f.match).length}`,
  }));

  // Counted per cabinet, same as the filter chips.
  const kpis = [
    { label: 'Stations charging', value: `${sum.charging}`, unit: `/ ${sum.stations}`, color: 'var(--warn-text)' },
    { label: 'Available',         value: `${sum.available}`, unit: '', color: 'var(--ok-text)' },
    { label: 'Fault',             value: `${sum.fault}`,     unit: '', color: sum.fault ? 'var(--error-text)' : 'var(--text-muted)' },
    { label: 'No live data',      value: `${sum.noData}`,    unit: '', color: 'var(--text-muted)' },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '1.25rem', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 className="section-title" style={{ fontSize: 18 }}>Charging — All Stations</h1>
          <p className="section-subtitle">
            {loading ? 'Loading charging data...' : `${stations.length} stations`}
            {fetchedAt > 0 && ` · updated ${fmtTime(new Date(fetchedAt).toISOString())}`}
            {error && <span style={{ color: 'var(--error-text)' }}> · API error: {error}</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Segmented value={filter} options={filterOptions} onChange={setFilter} />
          <Segmented value={sort} options={[{ id: 'power', label: 'kW ↓' }, { id: 'az', label: 'A-Z' }]} onChange={setSort} />
          <input
            type="text" className="input" placeholder="Search stations..."
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ width: 200, fontSize: 12 }}
          />
        </div>
      </div>

      {/* Fleet counts per cabinet */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
        {kpis.map(k => (
          <div key={k.label} className="card" style={{ padding: '0.875rem 1rem' }}>
            <div className="stat-value" style={{ color: k.color, fontSize: 24 }}>
              {k.value}
              {k.unit && <span style={{ fontSize: 13, marginLeft: 4, color: 'var(--text-muted)', fontWeight: 600 }}>{k.unit}</span>}
            </div>
            <div className="stat-label">{k.label}</div>
          </div>
        ))}
      </div>

      {loading && (
        <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          Loading charging data...
        </div>
      )}

      {!loading && shown.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
          {stations.length === 0 ? 'No stations configured.' : 'No stations match this filter.'}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>
        {shown.map(s => <StationCard key={s.station.id} s={s} />)}
      </div>
    </div>
  );
}
