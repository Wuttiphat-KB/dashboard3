'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useStations } from '@/lib/hooks/useStations';
import { useFleet } from '@/lib/hooks/useFleet';
import { resolveCoords, THAILAND_CENTER, LatLng } from '@/lib/stationGeo';

type Status = 'online' | 'degraded' | 'offline' | 'unknown';

const STATUS_HEX: Record<Status, string> = {
  online:   '#3fb950',
  degraded: '#e3b341',
  offline:  '#f85149',
  unknown:  '#768390',
};

const STATUS_LABEL: Record<Status, string> = {
  online:   'Online',
  degraded: 'Degraded',
  offline:  'Offline',
  unknown:  'No data',
};

// CDN for Leaflet — loaded at runtime so we add no build dependency.
const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS  = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';

// Dark/light basemap tiles (CartoDB) so the map matches the dashboard theme.
const TILES = {
  dark:  'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
};
const TILE_ATTR = '&copy; OpenStreetMap &copy; CARTO';

interface MapStation {
  id: string;
  displayName: string;
  location: string;
  status: Status;
  coords: LatLng | null;
}

function loadLeaflet(): Promise<any> {
  const w = window as any;
  if (w.L) return Promise.resolve(w.L);

  // CSS (once)
  if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = LEAFLET_CSS;
    document.head.appendChild(link);
  }

  // JS (once, reuse in-flight promise)
  if (w.__leafletPromise) return w.__leafletPromise;
  w.__leafletPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = LEAFLET_JS;
    script.async = true;
    script.onload = () => resolve((window as any).L);
    script.onerror = () => reject(new Error('Failed to load Leaflet'));
    document.body.appendChild(script);
  });
  return w.__leafletPromise;
}

export default function StationMapPage() {
  const { stations, loading: stationsLoading } = useStations();
  const { fleet } = useFleet();

  const mapElRef   = useRef<HTMLDivElement | null>(null);
  const mapRef     = useRef<any>(null);
  const tileRef    = useRef<any>(null);
  const markersRef = useRef<Map<string, any>>(new Map());

  const [theme, setTheme]       = useState<'dark' | 'light'>('dark');
  const [mapStatus, setMapStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch]     = useState('');

  // Track the active theme so the basemap matches.
  useEffect(() => {
    const read = () =>
      setTheme((document.documentElement.getAttribute('data-theme') as 'light') === 'light' ? 'light' : 'dark');
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  // Build the merged station list (config location + live fleet status).
  const mapStations = useMemo<MapStation[]>(() => {
    const statusById = new Map<string, Status>();
    for (const f of fleet) statusById.set(f.station.id, f.status as Status);

    return stations
      .map((s): MapStation => ({
        id: s.id,
        displayName: s.displayName || s.name || s.id,
        location: s.location || '',
        status: statusById.get(s.id) ?? 'unknown',
        // Prefer explicit lat/lng from config; fall back to the location lookup.
        coords: Number.isFinite(s.lat) && Number.isFinite(s.lng)
          ? { lat: s.lat as number, lng: s.lng as number }
          : resolveCoords(s.location),
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { numeric: true, sensitivity: 'base' }));
  }, [stations, fleet]);

  // Search filter — matches id / name / location, like the other pages.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return mapStations;
    return mapStations.filter(s =>
      s.id.toLowerCase().includes(q) ||
      s.displayName.toLowerCase().includes(q) ||
      s.location.toLowerCase().includes(q),
    );
  }, [mapStations, search]);

  const mapped   = useMemo(() => filtered.filter(s => s.coords), [filtered]);
  const unmapped = useMemo(() => mapStations.filter(s => !s.coords), [mapStations]);
  // Stable signature of which stations are on the map (ids + coords). Markers
  // rebuild + the view refits only when this changes (search / data), not on
  // every 30s status poll (status isn't part of the key).
  const mappedKey = useMemo(
    () => mapped.map(s => `${s.id}:${s.coords!.lat},${s.coords!.lng}`).join('|'),
    [mapped],
  );

  const counts = useMemo(() => {
    const c = { online: 0, degraded: 0, offline: 0, unknown: 0 };
    for (const s of mapStations) c[s.status]++;
    return c;
  }, [mapStations]);

  // Initialise the map once Leaflet is available.
  useEffect(() => {
    let cancelled = false;
    loadLeaflet()
      .then((L) => {
        if (cancelled || !mapElRef.current || mapRef.current) return;
        const map = L.map(mapElRef.current, { zoomControl: true, attributionControl: true })
          .setView([THAILAND_CENTER.lat, THAILAND_CENTER.lng], 6);
        mapRef.current = map;
        // Tiles are added by the [theme, mapStatus] effect below — keeps the
        // basemap in sync with the active theme without a capture race.
        setMapStatus('ready');
      })
      .catch(() => { if (!cancelled) setMapStatus('error'); });

    return () => {
      cancelled = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      markersRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply the basemap whenever the map becomes ready or the theme changes.
  // Driving tiles from here (not the async init callback) avoids the capture
  // race where the map loads with a stale theme value.
  useEffect(() => {
    const w = window as any;
    if (mapStatus !== 'ready' || !mapRef.current || !w.L) return;
    if (tileRef.current) tileRef.current.remove();
    tileRef.current = w.L.tileLayer(TILES[theme], { attribution: TILE_ATTR, maxZoom: 19 }).addTo(mapRef.current);
  }, [theme, mapStatus]);

  // (Re)draw markers when data changes.
  useEffect(() => {
    const w = window as any;
    if (mapStatus !== 'ready' || !mapRef.current || !w.L) return;
    const L = w.L;
    const map = mapRef.current;

    markersRef.current.forEach(mk => map.removeLayer(mk));
    markersRef.current.clear();

    for (const s of mapped) {
      const color = STATUS_HEX[s.status];
      const marker = L.circleMarker([s.coords!.lat, s.coords!.lng], {
        radius: 8, color: '#0d1117', weight: 1.5,
        fillColor: color, fillOpacity: 0.95,
      }).addTo(map);
      marker.bindPopup(
        `<div style="font-family:monospace;min-width:170px">
           <div style="font-weight:700;margin-bottom:2px">${escapeHtml(s.displayName)}</div>
           <div style="color:#666;font-size:11px;margin-bottom:6px">${escapeHtml(s.location)}</div>
           <div style="font-size:11px;margin-bottom:6px">
             <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:5px"></span>
             ${STATUS_LABEL[s.status]}
           </div>
           <div style="font-size:10px;color:#888;margin-bottom:6px">📍 ${fmtCoords(s.coords!)}</div>
           <a href="/station/${encodeURIComponent(s.id)}" style="color:#0969da;font-size:11px">View station →</a>
         </div>`
      );
      marker.on('click', () => setSelectedId(s.id));
      markersRef.current.set(s.id, marker);
    }

    // Fit the view to the current marker set (initial load + search changes).
    // Status polls don't reach here because they don't change `mappedKey`.
    if (mapped.length > 0) {
      const bounds = L.latLngBounds(mapped.map(s => [s.coords!.lat, s.coords!.lng]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 11 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mappedKey, mapStatus]);

  // Recolor markers without refitting when only status changes.
  useEffect(() => {
    if (mapStatus !== 'ready') return;
    for (const s of mapped) {
      const mk = markersRef.current.get(s.id);
      if (mk) mk.setStyle({ fillColor: STATUS_HEX[s.status] });
    }
  }, [mapStations, mapStatus, mapped]);

  const focusStation = (s: MapStation) => {
    setSelectedId(s.id);
    if (!s.coords || mapStatus !== 'ready' || !mapRef.current) return;
    mapRef.current.setView([s.coords.lat, s.coords.lng], 13, { animate: true });
    const mk = markersRef.current.get(s.id);
    if (mk) mk.openPopup();
  };

  const statItems: { label: string; value: number; color: string }[] = [
    { label: 'Total',    value: mapStations.length, color: 'var(--text-primary)' },
    { label: 'Online',   value: counts.online,      color: 'var(--ok-text)' },
    { label: 'Degraded', value: counts.degraded,    color: 'var(--warn-text)' },
    { label: 'Offline',  value: counts.offline,     color: 'var(--error-text)' },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '1.25rem', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 className="section-title" style={{ fontSize: 18 }}>Station Map</h1>
          <p className="section-subtitle">
            {mapStations.length} stations · {mapped.length} on map
            {search.trim() && ` · ${filtered.length} match "${search.trim()}"`}
            {!search.trim() && unmapped.length > 0 && ` · ${unmapped.length} without location`}
          </p>
        </div>
        <input
          type="text"
          className="input"
          placeholder="Search stations..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: 200, fontSize: 12 }}
        />
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        {statItems.map(s => (
          <div key={s.label} className="card" style={{ padding: '0.875rem' }}>
            <div className="stat-value" style={{ color: s.color, fontSize: 22 }}>{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Map + list */}
      <div className="map-layout">
        {/* Station list */}
        <div className="card" style={{ padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="card-title">Stations</span>
            <Legend />
          </div>
          <div className="map-station-list">
            {stationsLoading && mapStations.length === 0 ? (
              <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Loading…</div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                {search.trim() ? `No stations match "${search.trim()}"` : 'No stations configured.'}
              </div>
            ) : (
              <>
                {filtered.map(s => (
                  <div
                    key={s.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 9,
                      background: selectedId === s.id ? 'var(--info-bg)' : 'transparent',
                      borderBottom: '1px solid var(--border-subtle)',
                      padding: '9px 12px',
                    }}
                  >
                    <button
                      onClick={() => focusStation(s)}
                      disabled={!s.coords}
                      title={s.coords ? 'Show on map' : 'No location data'}
                      style={{
                        flex: 1, minWidth: 0, textAlign: 'left', cursor: s.coords ? 'pointer' : 'default',
                        background: 'transparent', border: 'none', padding: 0,
                        display: 'flex', alignItems: 'center', gap: 9,
                        color: 'inherit', fontFamily: 'var(--font-geist-mono), monospace',
                        opacity: s.coords ? 1 : 0.55,
                      }}
                    >
                      <span style={{
                        width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                        background: STATUS_HEX[s.status],
                        boxShadow: s.status !== 'unknown' ? `0 0 6px ${STATUS_HEX[s.status]}` : 'none',
                      }} />
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {s.displayName}
                        </span>
                        <span style={{ display: 'block', fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {s.location || '— no location —'}
                        </span>
                        <span style={{ display: 'block', fontSize: 10, color: 'var(--text-secondary)' }}>
                          {s.coords ? `📍 ${fmtCoords(s.coords)}` : '—'}
                        </span>
                      </span>
                    </button>
                    <Link
                      href={`/station/${encodeURIComponent(s.id)}`}
                      title="View station"
                      style={{
                        flexShrink: 0, fontSize: 11, color: 'var(--info-text)',
                        textDecoration: 'none', whiteSpace: 'nowrap', padding: '2px 4px',
                      }}
                    >
                      View →
                    </Link>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        {/* Map */}
        <div className="card" style={{ padding: 0, position: 'relative', overflow: 'hidden' }}>
          <div ref={mapElRef} className="map-canvas" />
          {mapStatus !== 'ready' && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 8,
              background: 'var(--bg-card)', color: 'var(--text-muted)', fontSize: 12,
              textAlign: 'center', padding: '1rem',
            }}>
              {mapStatus === 'loading'
                ? 'Loading map…'
                : '⚠ Could not load the map (offline?). Station locations are listed on the left.'}
            </div>
          )}
        </div>
      </div>

      {/* Scoped styles for the map layout + Leaflet theming */}
      <style>{`
        .map-layout {
          display: grid;
          grid-template-columns: 320px 1fr;
          gap: 1rem;
          align-items: stretch;
        }
        .map-station-list {
          overflow-y: auto;
          max-height: calc(100vh - 320px);
          min-height: 300px;
        }
        .map-canvas {
          width: 100%;
          height: calc(100vh - 260px);
          min-height: 420px;
          background: var(--bg-elevated);
        }
        .map-canvas .leaflet-container { background: var(--bg-elevated); font-family: var(--font-geist-mono), monospace; }
        .leaflet-popup-content-wrapper, .leaflet-popup-tip { border-radius: 6px; }
        @media (max-width: 900px) {
          .map-layout { grid-template-columns: 1fr; }
          .map-station-list { max-height: 320px; }
          .map-canvas { height: 60vh; min-height: 360px; }
        }
      `}</style>
    </div>
  );
}

function Legend() {
  const items: { s: Status }[] = [{ s: 'online' }, { s: 'degraded' }, { s: 'offline' }];
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      {items.map(({ s }) => (
        <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-muted)' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_HEX[s] }} />
          {STATUS_LABEL[s]}
        </span>
      ))}
    </div>
  );
}

function fmtCoords(c: LatLng): string {
  const lat = `${Math.abs(c.lat).toFixed(5)}°${c.lat >= 0 ? 'N' : 'S'}`;
  const lng = `${Math.abs(c.lng).toFixed(5)}°${c.lng >= 0 ? 'E' : 'W'}`;
  return `${lat}, ${lng}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
