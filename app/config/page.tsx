'use client';

import { useState, useEffect } from 'react';
import { useStations } from '@/lib/hooks/useStations';
import { Station } from '@/lib/types';

const EMPTY_STATION: Omit<Station, 'id' | 'createdAt'> = {
  name: '',
  displayName: '',
  location: '',
  chargerHeads: 2,
  expectedPmPerHead: 3,
  expectedPmHead1: 3,
  expectedPmHead2: 3,
  fanBrand: 'EBM',
  mqttTopics: {
    heartbeat:    '',
    heartbeatPi5: '',
    router:       '',
    meter:        '',
    powerModule:  '',
    faultStatus:  '',
    statePlc:     '',
    fanRPM:       '',
    plc:          '',
  },
  mongoCollections: {
    powerModule:          '',
    meter:                '',
    heartbeatFallingEdge: '',
    router:               '',
    statePlc:             '',
  },
  telegram: { chatId: '', botToken: '', enabled: false },
};

type FormState = Omit<Station, 'id' | 'createdAt'> & { id?: string };

function InputRow({ label, value, onChange, placeholder, hint, mono = true }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; hint?: string; mono?: boolean;
}) {
  return (
    <div>
      <label className="input-label">{label}</label>
      <input
        className="input"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={mono ? { fontFamily: 'var(--font-geist-mono), monospace' } : {}}
      />
      {hint && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

function SectionHeader({ title, subtitle, icon }: { title: string; subtitle?: string; icon?: string }) {
  return (
    <div style={{ marginBottom: '1rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-subtle)' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--info-text)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 6 }}>
        {icon && <span>{icon}</span>}
        {title}
      </div>
      {subtitle && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>{subtitle}</div>}
    </div>
  );
}

export default function ConfigPage() {
  const { stations: fetchedStations, loading: stationsLoading } = useStations();
  const [stations, setStations] = useState<Station[]>([]);
  const [mode, setMode] = useState<'list' | 'add' | 'edit'>('list');

  // Sync when hook finishes loading
  useEffect(() => {
    if (!stationsLoading) setStations(fetchedStations);
  }, [fetchedStations, stationsLoading]);
  const [form, setForm] = useState<FormState>({ ...EMPTY_STATION });
  const [saved, setSaved] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const setTopic   = (key: keyof Station['mqttTopics'],       val: string) =>
    setForm(f => ({ ...f, mqttTopics:       { ...f.mqttTopics,       [key]: val } }));
  const setMongo   = (key: keyof Station['mongoCollections'], val: string) =>
    setForm(f => ({ ...f, mongoCollections: { ...f.mongoCollections, [key]: val } }));
  const setTelegram = (key: keyof Station['telegram'], val: string | boolean) =>
    setForm(f => ({ ...f, telegram: { ...f.telegram, [key]: val } }));

  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);

    let stationDoc: Station;
    if (mode === 'edit' && form.id) {
      stationDoc = { ...form, id: form.id, createdAt: stations.find(s => s.id === form.id)?.createdAt ?? new Date().toISOString() } as Station;
      setStations(prev => prev.map(s => s.id === form.id ? stationDoc : s));
    } else {
      stationDoc = {
        ...form,
        id:        form.name.toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9-]/g, ''),
        createdAt: new Date().toISOString(),
      };
      setStations(prev => [...prev, stationDoc]);
    }

    // Save to MongoDB (db=Station, collection=station.name)
    try {
      await fetch('/api/stations/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(stationDoc),
      });
    } catch (err) {
      console.error('Failed to save to MongoDB:', err);
    }

    setSaving(false);
    setSaved(true);
    setTimeout(() => { setSaved(false); setMode('list'); }, 1500);
  };

  const handleDelete = (id: string) => {
    setStations(prev => prev.filter(s => s.id !== id));
    setDeleteConfirm(null);
  };

  // ── List ────────────────────────────────────────────────────────────────────
  if (mode === 'list') {
    return (
      <div>
        <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 className="section-title" style={{ fontSize: 18 }}>Station Config</h1>
            <p className="section-subtitle">{stations.length} stations configured</p>
          </div>
          <button className="btn btn-primary" onClick={() => { setForm({ ...EMPTY_STATION }); setMode('add'); }}>
            + Add Station
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {stations.map(station => (
            <div key={station.id} className="card" style={{ padding: '1rem 1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{station.displayName || station.name}</span>
                    <span className="badge badge-info" style={{ fontSize: 10 }}>{station.name}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{station.chargerHeads} heads · {station.fanBrand}</span>
                  </div>
                  {/* Quick topic summary */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 4 }}>
                    {[
                      { label: 'HB',     value: station.mqttTopics?.heartbeat    || '—' },
                      { label: 'Pi5',    value: station.mqttTopics?.heartbeatPi5 || '—' },
                      { label: 'Meter',  value: station.mqttTopics?.meter        || '—' },
                      { label: 'PLC',    value: station.mqttTopics?.plc          || '—' },
                      { label: 'Fan',    value: station.mqttTopics?.fanRPM       || '—' },
                      { label: 'Mongo Meter', value: station.mongoCollections?.meter || '—' },
                    ].map(r => (
                      <div key={r.label} style={{ fontSize: 10 }}>
                        <span style={{ color: 'var(--text-muted)', fontSize: 9, textTransform: 'uppercase' }}>{r.label}: </span>
                        <span style={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{r.value}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => {
                    // Merge with EMPTY_STATION to ensure no undefined fields
                    setForm({
                      ...EMPTY_STATION,
                      ...station,
                      // Backwards-compat: if old config has only expectedPmPerHead, use it for both heads
                      expectedPmHead1: station.expectedPmHead1 ?? station.expectedPmPerHead ?? 3,
                      expectedPmHead2: station.expectedPmHead2 ?? station.expectedPmPerHead ?? 3,
                      mqttTopics:       { ...EMPTY_STATION.mqttTopics,       ...(station.mqttTopics       || {}) },
                      mongoCollections: { ...EMPTY_STATION.mongoCollections, ...(station.mongoCollections || {}) },
                      telegram:         { ...EMPTY_STATION.telegram,         ...(station.telegram         || {}) },
                    });
                    setMode('edit');
                  }}>Edit</button>
                  {deleteConfirm === station.id ? (
                    <>
                      <button className="btn btn-danger btn-sm" onClick={() => handleDelete(station.id)}>Confirm Delete</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => setDeleteConfirm(null)}>Cancel</button>
                    </>
                  ) : (
                    <button className="btn btn-danger btn-sm" onClick={() => setDeleteConfirm(station.id)}>Delete</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Add / Edit form ─────────────────────────────────────────────────────────
  return (
    <div>
      <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="btn btn-secondary btn-sm" onClick={() => setMode('list')}>← Back</button>
        <div>
          <h1 className="section-title" style={{ fontSize: 18 }}>
            {mode === 'add' ? 'Add New Station' : `Edit — ${form.displayName || form.name || form.id}`}
          </h1>
          <p className="section-subtitle">Configure MQTT topics, MongoDB collections, and Telegram</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1rem' }}>

        {/* ── Station Info ── */}
        <div className="card">
          <SectionHeader icon="◧" title="Station Info" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            <InputRow label="Station Name (internal / MongoDB collection)"
              value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))}
              placeholder="e.g. BKK-003" mono={true}
              hint="Used as backend identifier and MongoDB collection name" />
            <InputRow label="Display Name (shown on dashboard)"
              value={form.displayName} onChange={v => setForm(f => ({ ...f, displayName: v }))}
              placeholder="e.g. บางนา สาขา 1" mono={false} />
            <InputRow label="Location" value={form.location} onChange={v => setForm(f => ({ ...f, location: v }))} placeholder="e.g. Bangkok – Siam Paragon" mono={false} />
            <div>
              <label className="input-label">Number of Charger Heads</label>
              <input className="input" type="number" min={1} max={8}
                value={form.chargerHeads}
                onChange={e => setForm(f => ({ ...f, chargerHeads: Number(e.target.value) }))}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label className="input-label">Expected PM — Head 1</label>
                <input className="input" type="number" min={1} max={10}
                  value={form.expectedPmHead1 ?? 3}
                  onChange={e => setForm(f => ({ ...f, expectedPmHead1: Number(e.target.value) }))}
                />
              </div>
              <div>
                <label className="input-label">Expected PM — Head 2</label>
                <input className="input" type="number" min={1} max={10}
                  value={form.expectedPmHead2 ?? 3}
                  onChange={e => setForm(f => ({ ...f, expectedPmHead2: Number(e.target.value) }))}
                />
              </div>
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: -4 }}>
              Alert triggers when active PM count drops below the expected value per head
            </div>
            <div>
              <label className="input-label">Fan Brand</label>
              <select className="input"
                value={form.fanBrand}
                onChange={e => setForm(f => ({ ...f, fanBrand: e.target.value }))}
              >
                <option value="EBM">EBM</option>
                <option value="Winstrom">Winstrom</option>
                <option value="DAKO">DAKO</option>
              </select>
            </div>
          </div>
        </div>

        {/* ── MQTT Topics ── */}
        <div className="card">
          <SectionHeader icon="⇆" title="MQTT Topics" subtitle="Topics subscribed on the MQTT broker" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <InputRow label="Heartbeat"
              value={form.mqttTopics.heartbeat} onChange={v => setTopic('heartbeat', v)}
              placeholder="ev/STID/heartbeat"
              hint={'{"heartbeat":1,"timestamp":"..."}'} />
            <InputRow label="Heartbeat Pi5"
              value={form.mqttTopics.heartbeatPi5} onChange={v => setTopic('heartbeatPi5', v)}
              placeholder="ev/STID/heartbeatPI5"
              hint={'{"heartbeatPI5":1,"timestamp":"..."}'} />
            <InputRow label="Router"
              value={form.mqttTopics.router} onChange={v => setTopic('router', v)}
              placeholder="ev/STID/router/status"
              hint="connstate, temp (÷10 = °C), signal RSSI/RSRP/RSRQ" />
            <InputRow label="Meter"
              value={form.mqttTopics.meter} onChange={v => setTopic('meter', v)}
              placeholder="ev/STID/meter/data"
              hint={'{"meter1":131734760,"meter2":119364060,...} (Wh)'} />
            <InputRow label="Power Module"
              value={form.mqttTopics.powerModule} onChange={v => setTopic('powerModule', v)}
              placeholder="ev/STID/pm/data"
              hint={'{"PM1":"2","Voltage1":418.2,...} / {"PM2":"3",...}'} />
            <InputRow label="Fault Status Heartbeat"
              value={form.mqttTopics.faultStatus} onChange={v => setTopic('faultStatus', v)}
              placeholder="ev/STID/script/fault_hb"
              hint='{"heartbeat":1,"timestamp":"..."} → script heartbeat' />
            <InputRow label="Fan RPM"
              value={form.mqttTopics.fanRPM} onChange={v => setTopic('fanRPM', v)}
              placeholder="ev/STID/fan/rpm"
              hint={'{"FAN 1":5397.99,...,"FAN 8":5503.99}'} />
            <InputRow label="PLC Data"
              value={form.mqttTopics.plc} onChange={v => setTopic('plc', v)}
              placeholder="ev/STID/plc/data"
              hint="Full PLC payload + used for PLC script heartbeat timeout detection" />
          </div>
        </div>

        {/* ── MongoDB Collections ── */}
        <div className="card">
          <SectionHeader icon="▣" title="MongoDB Collections" subtitle="Collection names in your database" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            <InputRow label="Power Module Collection"
              value={form.mongoCollections.powerModule} onChange={v => setMongo('powerModule', v)}
              placeholder="STID_powermodule"
              hint="Data forwarded from MQTT → fetched on load" />
            <InputRow label="Meter Collection"
              value={form.mongoCollections.meter} onChange={v => setMongo('meter', v)}
              placeholder="STID_meter"
              hint="Data forwarded from MQTT → fetched on load" />
            <InputRow label="Heartbeat Falling Edge Collection"
              value={form.mongoCollections.heartbeatFallingEdge} onChange={v => setMongo('heartbeatFallingEdge', v)}
              placeholder="STID_hb_falling" />
            <InputRow label="Router Collection"
              value={form.mongoCollections.router} onChange={v => setMongo('router', v)}
              placeholder="STID_router" />
            <InputRow label="State PLC Collection"
              value={form.mongoCollections.statePlc} onChange={v => setMongo('statePlc', v)}
              placeholder="STID"
              hint="Collection in StatePLC database — full PLC payload forwarded from MQTT" />
          </div>
        </div>

        {/* ── Telegram ── */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--info-text)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              ✈ Telegram Config
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.telegram.enabled}
                onChange={e => setTelegram('enabled', e.target.checked)}
                style={{ accentColor: 'var(--info)', width: 14, height: 14 }} />
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Enabled</span>
            </label>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            <InputRow label="Chat ID" value={form.telegram.chatId} onChange={v => setTelegram('chatId', v)}
              placeholder="-100123456789"
              hint="Group/user chat ID. Use -100... for groups." />
            <InputRow label="Bot Token" value={form.telegram.botToken} onChange={v => setTelegram('botToken', v)}
              placeholder="123456789:AABBccdd..."
              hint="Leave blank to use global bot token from Settings" />
          </div>

          {/* Alert triggers summary */}
          <div style={{ marginTop: 16, padding: '12px', background: 'var(--bg-elevated)', borderRadius: 6 }}>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 8 }}>Alert Triggers</div>
            {[
              { label: 'Router temp > threshold (default 80 °C)', active: true },
              { label: 'Heartbeat device offline > 5 min',         active: true },
              { label: 'Meter value unchanged > 2 days (LED red)', active: false },
              { label: 'Power module fault',                       active: true },
              { label: 'Fan RPM = 0',                              active: true },
            ].map(t => (
              <div key={t.label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, fontSize: 11 }}>
                <span className={`led ${t.active ? 'led-ok' : 'led-offline'}`} />
                <span style={{ color: t.active ? 'var(--text-secondary)' : 'var(--text-muted)' }}>{t.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Save */}
      <div style={{ marginTop: '1.5rem', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="btn btn-primary" onClick={handleSave}
          disabled={!form.name.trim() || saving} style={{ opacity: form.name.trim() && !saving ? 1 : 0.5 }}>
          {saving ? 'Saving...' : `✓ ${mode === 'add' ? 'Add Station' : 'Save Changes'}`}
        </button>
        <button className="btn btn-secondary" onClick={() => setMode('list')}>Cancel</button>
        {saved && (
          <span className="badge badge-ok">
            <span className="led led-ok" />
            {mode === 'add' ? 'Station added!' : 'Saved!'}
          </span>
        )}
      </div>
    </div>
  );
}
