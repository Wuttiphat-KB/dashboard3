'use client';

import { useState } from 'react';

interface ThresholdConfig {
  tempAlert: number;
  heartbeatTimeout: number;
  meterStaledays: number;
  fanMinRPM: number;
}

interface TelegramGlobal {
  defaultBotToken: string;
  enabled: boolean;
}

export default function SettingsPage() {
  const [thresholds, setThresholds] = useState<ThresholdConfig>({
    tempAlert:        75,
    heartbeatTimeout: 5,
    meterStaledays:   2,
    fanMinRPM:        500,
  });

  const [telegram, setTelegram] = useState<TelegramGlobal>({
    defaultBotToken: 'mock-global-token-xxxxx',
    enabled: true,
  });

  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 className="section-title" style={{ fontSize: 18 }}>Settings</h1>
        <p className="section-subtitle">Global thresholds &amp; notification configuration</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1rem' }}>
        {/* Thresholds */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">⊙ Alert Thresholds</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label className="input-label">Temperature Alert (°C)</label>
              <input
                className="input"
                type="number"
                value={thresholds.tempAlert}
                onChange={e => setThresholds(t => ({ ...t, tempAlert: Number(e.target.value) }))}
              />
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                Send Telegram alert when router temp exceeds this value
              </div>
            </div>

            <div>
              <label className="input-label">Heartbeat Timeout (minutes)</label>
              <input
                className="input"
                type="number"
                value={thresholds.heartbeatTimeout}
                onChange={e => setThresholds(t => ({ ...t, heartbeatTimeout: Number(e.target.value) }))}
              />
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                Mark device as offline if no heartbeat received within this time
              </div>
            </div>

            <div>
              <label className="input-label">Meter Stale Threshold (days)</label>
              <input
                className="input"
                type="number"
                value={thresholds.meterStaledays}
                onChange={e => setThresholds(t => ({ ...t, meterStaledays: Number(e.target.value) }))}
              />
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                Set meter LED to RED if value unchanged for this many days
              </div>
            </div>

            <div>
              <label className="input-label">Fan Minimum RPM</label>
              <input
                className="input"
                type="number"
                value={thresholds.fanMinRPM}
                onChange={e => setThresholds(t => ({ ...t, fanMinRPM: Number(e.target.value) }))}
              />
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                Alert if fan RPM drops below this value during operation
              </div>
            </div>
          </div>
        </div>

        {/* Telegram */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">✈ Telegram Notification</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={telegram.enabled}
                onChange={e => setTelegram(t => ({ ...t, enabled: e.target.checked }))}
                style={{ accentColor: 'var(--info)', width: 14, height: 14 }}
              />
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Enabled</span>
            </label>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label className="input-label">Default Bot Token</label>
              <input
                className="input"
                type="text"
                value={telegram.defaultBotToken}
                onChange={e => setTelegram(t => ({ ...t, defaultBotToken: e.target.value }))}
                placeholder="123456789:AABBccddEEff..."
              />
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                Used when no per-station bot token is set
              </div>
            </div>

            <div style={{ padding: '12px', background: 'var(--bg-elevated)', borderRadius: 6 }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8, fontWeight: 600 }}>
                Alert Triggers
              </div>
              {[
                { label: 'Router temp > threshold', active: true },
                { label: 'Heartbeat timeout',       active: true },
                { label: 'Meter stale',             active: false },
                { label: 'Power module fault',      active: true },
                { label: 'Fan fault',               active: true },
              ].map(t => (
                <div key={t.label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, fontSize: 11 }}>
                  <span className={`led ${t.active ? 'led-ok' : 'led-offline'}`} />
                  <span style={{ color: t.active ? 'var(--text-secondary)' : 'var(--text-muted)' }}>{t.label}</span>
                </div>
              ))}
            </div>

            <div style={{ padding: '12px', background: 'var(--info-bg)', borderRadius: 6, fontSize: 11, color: 'var(--info-text)', lineHeight: 1.8 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Per-station config</div>
              <div style={{ color: 'var(--text-secondary)' }}>
                Each station can have its own Chat ID and Bot Token.<br />
                Configure them in Station Config → Edit Station.
              </div>
            </div>
          </div>
        </div>

        {/* System info */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">⊙ System</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { label: 'Mode',         value: 'Mock Data (Frontend Only)' },
              { label: 'Stack',        value: 'Next.js 16 + TypeScript' },
              { label: 'Styling',      value: 'Tailwind CSS v4 + Custom Vars' },
              { label: 'State',        value: 'React Context (planned)' },
              { label: 'WebSocket',    value: 'Not connected (set NEXT_PUBLIC_WS_URL)' },
              { label: 'Database',     value: 'MongoDB (backend pending)' },
              { label: 'MQTT Bridge',  value: 'Node.js bridge (backend pending)' },
            ].map(row => (
              <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.05em' }}>{row.label}</span>
                <span style={{ color: 'var(--text-secondary)' }}>{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Save button */}
      <div style={{ marginTop: '1.5rem', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="btn btn-primary" onClick={handleSave}>
          ✓ Save Settings
        </button>
        {saved && (
          <span className="badge badge-ok">
            <span className="led led-ok" />
            Saved successfully
          </span>
        )}
      </div>
    </div>
  );
}
