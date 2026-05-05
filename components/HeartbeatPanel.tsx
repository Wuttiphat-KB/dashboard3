'use client';

import { HeartbeatDevice } from '@/lib/types';
import { fmtTs, timeSince } from '@/lib/formatTime';

interface Props {
  heartbeats: HeartbeatDevice[];
  fleetTotals?: {
    mainOnline: number; mainTotal: number;
    pi5Online: number;  pi5Total: number;
    routerOnline: number; routerTotal: number;
  };
}

const DEVICE_META: Record<string, { abbr: string; payloadKey: string }> = {
  heartbeat:    { abbr: 'OC',  payloadKey: 'heartbeat'   },
  heartbeatPi5: { abbr: 'PI5', payloadKey: 'heartbeatPI5' },
  router:       { abbr: 'RTR', payloadKey: 'connstate'   },
};

export default function HeartbeatPanel({ heartbeats, fleetTotals }: Props) {
  const online = heartbeats.filter(h => h.online).length;
  const total  = heartbeats.length;
  const allOk  = online === total;
  const allOff = online === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* ── Fleet totals (shown only when passed from overview) ── */}
      {fleetTotals && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
          {[
            { label: 'OCPP Device Online', on: fleetTotals.mainOnline,   tot: fleetTotals.mainTotal,   key: 'heartbeat'    },
            { label: 'Pi5 Online',        on: fleetTotals.pi5Online,    tot: fleetTotals.pi5Total,    key: 'heartbeatPi5' },
            { label: 'Router Online',     on: fleetTotals.routerOnline, tot: fleetTotals.routerTotal, key: 'router'       },
          ].map(s => {
            const ok = s.on === s.tot;
            return (
              <div key={s.label} className="card" style={{ padding: '0.875rem 1rem', borderColor: ok ? 'var(--border)' : 'var(--warn)' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <span style={{ fontSize: 28, fontWeight: 800, color: ok ? 'var(--ok)' : s.on === 0 ? 'var(--error)' : 'var(--warn)', lineHeight: 1 }}>{s.on}</span>
                  <span style={{ fontSize: 15, color: 'var(--text-muted)', fontWeight: 500 }}>/{s.tot}</span>
                </div>
                <div className="stat-label" style={{ marginTop: 4 }}>{s.label}</div>
                <div style={{ marginTop: 6 }}>
                  <div className="gauge-track" style={{ height: 4 }}>
                    <div className="gauge-fill" style={{
                      width: `${s.tot > 0 ? (s.on / s.tot) * 100 : 0}%`,
                      background: ok ? 'var(--ok)' : s.on === 0 ? 'var(--error)' : 'var(--warn)',
                    }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Per-station summary ── */}
      <div className="card" style={{ padding: '1rem 1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <div>
            <div className="stat-value" style={{ color: allOk ? 'var(--ok)' : allOff ? 'var(--error)' : 'var(--warn)' }}>
              {online}<span className="stat-unit">/{total}</span>
            </div>
            <div className="stat-label">Devices Online</div>
          </div>
          <span className={`badge ${allOk ? 'badge-ok' : allOff ? 'badge-error' : 'badge-warn'}`} style={{ marginLeft: 'auto' }}>
            <span className={`led ${allOk ? 'led-ok led-pulse' : allOff ? 'led-error' : 'led-warn led-pulse'}`} />
            {allOk ? 'ALL ONLINE' : allOff ? 'ALL OFFLINE' : 'DEGRADED'}
          </span>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Timeout: <span style={{ color: 'var(--text-secondary)' }}>5 min</span>
          </div>
        </div>
      </div>

      {/* ── Device cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: '0.75rem' }}>
        {heartbeats.map((device) => {
          const meta = DEVICE_META[device.key];
          return (
            <div key={device.key} className="card" style={{ position: 'relative', overflow: 'hidden' }}>
              {/* Stripe */}
              <div style={{
                position: 'absolute', top: 0, left: 0, width: 3, height: '100%',
                background: device.online ? 'var(--ok)' : 'var(--error)',
                borderRadius: '8px 0 0 8px',
              }} />
              <div style={{ paddingLeft: 12 }}>
                {/* Header row */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 8,
                      background: device.online ? 'var(--ok-bg)' : 'var(--error-bg)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 700, color: device.online ? 'var(--ok)' : 'var(--error)',
                    }}>
                      {meta?.abbr ?? '—'}
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>{device.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1, fontFamily: 'monospace' }}>{device.topic}</div>
                    </div>
                  </div>
                  <span className={`badge ${device.online ? 'badge-ok' : 'badge-error'}`}>
                    <span className={`led ${device.online ? 'led-ok led-pulse' : 'led-error'}`} />
                    {device.online ? 'ONLINE' : 'OFFLINE'}
                  </span>
                </div>

                {/* Stats row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
                  <div style={{ background: 'var(--bg-elevated)', borderRadius: 6, padding: '7px 10px' }}>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 2, textTransform: 'uppercase' }}>Elapsed</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: device.online ? 'var(--ok-text)' : 'var(--error-text)' }}>
                      {timeSince(device.lastSeen)}
                    </div>
                  </div>
                  <div style={{ background: 'var(--bg-elevated)', borderRadius: 6, padding: '7px 10px' }}>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 2, textTransform: 'uppercase' }}>
                      {device.key === 'router' ? 'Conn State' : 'Timeout'}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: device.key === 'router' ? (device.online ? 'var(--ok-text)' : 'var(--error-text)') : 'var(--text-secondary)' }}>
                      {device.key === 'router' ? (device.connstate ?? '—') : '5 min'}
                    </div>
                  </div>
                </div>

                {/* Timestamp — prominent */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '7px 10px',
                  background: device.online ? 'var(--ok-bg)' : 'var(--error-bg)',
                  borderRadius: 6,
                  border: `1px solid ${device.online ? 'transparent' : 'var(--error)'}`,
                }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>Last message</span>
                  <span style={{
                    fontSize: 11, fontWeight: 600, fontFamily: 'monospace',
                    color: device.online ? 'var(--text-secondary)' : 'var(--error-text)',
                  }}>
                    {fmtTs(device.lastSeen)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Table ── */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Device Status Table</span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Offline if no message &gt; 5 min</span>
        </div>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Device</th>
                <th>MQTT Topic</th>
                <th>Status</th>
                <th>Conn State</th>
                <th>Last Message Timestamp</th>
                <th>Elapsed</th>
              </tr>
            </thead>
            <tbody>
              {heartbeats.map((device) => (
                <tr key={device.key}>
                  <td style={{ fontWeight: 600 }}>{device.name}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 11, fontFamily: 'monospace' }}>{device.topic}</td>
                  <td>
                    <span className={`badge ${device.online ? 'badge-ok' : 'badge-error'}`}>
                      <span className={`led ${device.online ? 'led-ok' : 'led-error'}`} />
                      {device.online ? 'Online' : 'Offline'}
                    </span>
                  </td>
                  <td style={{ fontSize: 11, color: device.key === 'router' ? (device.connstate === 'Connected' ? 'var(--ok-text)' : 'var(--error-text)') : 'var(--text-muted)' }}>
                    {device.key === 'router' ? device.connstate : '—'}
                  </td>
                  <td style={{ fontSize: 11, fontFamily: 'monospace', color: device.online ? 'var(--text-secondary)' : 'var(--error-text)', fontWeight: device.online ? 400 : 600 }}>
                    {fmtTs(device.lastSeen)}
                  </td>
                  <td style={{ color: device.online ? 'var(--ok-text)' : 'var(--error-text)', fontWeight: 600 }}>
                    {timeSince(device.lastSeen)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
