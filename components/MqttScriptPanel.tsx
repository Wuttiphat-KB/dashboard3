'use client';

import { MqttScript } from '@/lib/types';
import { fmtTs, timeSince } from '@/lib/formatTime';

interface Props {
  scripts: MqttScript[];
  stationId: string;
}

function HealthBar({ script }: { script: MqttScript }) {
  const elapsed = (Date.now() - new Date(script.lastHeartbeat).getTime()) / 1000;
  const pct = Math.min((elapsed / (script.expectedInterval * 3)) * 100, 100);
  const color = script.online ? 'var(--ok)' : 'var(--error)';

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>
        <span>Time since heartbeat</span>
        <span>{timeSince(script.lastHeartbeat)}</span>
      </div>
      <div className="gauge-track">
        <div className="gauge-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
        Expected every {script.expectedInterval}s
      </div>
    </div>
  );
}

export default function MqttScriptPanel({ scripts, stationId }: Props) {
  const online  = scripts.filter(s => s.online).length;
  const offline = scripts.filter(s => !s.online).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem' }}>
        {[
          { label: 'Scripts Online',  value: `${online}/${scripts.length}`, color: online === scripts.length ? 'var(--ok)' : 'var(--warn)' },
          { label: 'Scripts Offline', value: `${offline}`,                  color: offline > 0 ? 'var(--error)' : 'var(--text-muted)' },
          { label: 'Host',            value: 'Pi5',                          color: 'var(--info-text)' },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '0.875rem' }}>
            <div className="stat-value" style={{ color: s.color, fontSize: 22 }}>{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Script cards grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.75rem' }}>
        {scripts.map((script) => (
          <div key={script.name} className="card" style={{
            borderColor: script.online ? 'var(--border)' : 'var(--error)',
            background: script.online ? 'var(--bg-card)' : 'color-mix(in srgb, var(--error-bg) 40%, var(--bg-card))',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 6,
                  background: script.online ? 'var(--ok-bg)' : 'var(--error-bg)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14,
                }}>
                  {script.online ? '▶' : '■'}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                    {script.name}.py
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
                    Pi5 process
                  </div>
                </div>
              </div>
              <span className={`badge ${script.online ? 'badge-ok' : 'badge-error'}`}>
                <span className={`led ${script.online ? 'led-ok led-pulse' : 'led-error'}`} />
                {script.online ? 'RUNNING' : 'STOPPED'}
              </span>
            </div>

            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>
              {script.description}
            </div>

            <div style={{
              background: 'var(--bg-base)',
              borderRadius: 4,
              padding: '6px 8px',
              fontSize: 10,
              color: 'var(--text-muted)',
              fontFamily: 'monospace',
              marginBottom: 8,
            }}>
              ⇆ {script.mqttTopic}
            </div>

            <HealthBar script={script} />
          </div>
        ))}
      </div>

      {/* Table view */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Script Process Table</span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{stationId} · Pi5</span>
        </div>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Script</th>
                <th>MQTT Topic</th>
                <th>Heartbeat Interval</th>
                <th>Last Heartbeat</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {scripts.map(script => (
                <tr key={script.name}>
                  <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{script.name}.py</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 11 }}>{script.mqttTopic}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{script.expectedInterval}s</td>
                  <td style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    <div>{fmtTs(script.lastHeartbeat)}</div>
                    <div style={{ color: script.online ? 'var(--text-muted)' : 'var(--error-text)', fontSize: 10 }}>
                      {timeSince(script.lastHeartbeat)}
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${script.online ? 'badge-ok' : 'badge-error'}`}>
                      <span className={`led ${script.online ? 'led-ok' : 'led-error'}`} />
                      {script.online ? 'Running' : 'Stopped'}
                    </span>
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
