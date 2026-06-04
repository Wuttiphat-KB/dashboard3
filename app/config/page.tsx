'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
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
  hasPi5: true,
  fanBrand: 'EBM',
  hmiBrand: 'Phoenix',
  controllerType: 'phoenix',
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
    vectorState:  '',
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

function ConfigPageInner() {
  const { stations: fetchedStations, loading: stationsLoading } = useStations();
  const searchParams = useSearchParams();
  const router       = useRouter();
  const editId       = searchParams.get('edit');
  const [stations, setStations] = useState<Station[]>([]);
  const [mode, setMode] = useState<'list' | 'add' | 'edit'>('list');
  const [form, setForm] = useState<FormState>({ ...EMPTY_STATION });
  const [saved, setSaved] = useState(false);

  // PIN gate
  const [authState, setAuthState]   = useState<'checking' | 'locked' | 'unlocked'>('checking');
  const [pinInput, setPinInput]     = useState('');
  const [pinError, setPinError]     = useState('');
  const [pinSubmitting, setPinSubmitting] = useState(false);

  useEffect(() => {
    fetch('/api/auth/config-pin')
      .then(r => r.json())
      .then(j => setAuthState(j.ok ? 'unlocked' : 'locked'))
      .catch(() => setAuthState('locked'));
  }, []);

  const submitPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinSubmitting(true);
    setPinError('');
    try {
      const res = await fetch('/api/auth/config-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pinInput }),
      });
      if (res.ok) {
        setAuthState('unlocked');
        setPinInput('');
      } else {
        setPinError('Incorrect PIN');
      }
    } catch {
      setPinError('Network error');
    } finally {
      setPinSubmitting(false);
    }
  };

  const logout = async () => {
    await fetch('/api/auth/config-pin', { method: 'DELETE' }).catch(() => {});
    setAuthState('locked');
  };

  // Sync when hook finishes loading
  useEffect(() => {
    if (!stationsLoading) setStations(fetchedStations);
  }, [fetchedStations, stationsLoading]);

  const goToList = () => {
    setMode('list');
    if (editId) router.replace('/config');  // clear ?edit= from URL
  };

  // Auto-open edit form when ?edit=<id> is in URL (link from station detail page)
  useEffect(() => {
    if (!editId || stations.length === 0) return;
    const target = stations.find(s => s.id === editId || s.name === editId);
    if (!target) return;
    setForm({
      ...EMPTY_STATION,
      ...target,
      expectedPmHead1: target.expectedPmHead1 ?? target.expectedPmPerHead ?? 3,
      expectedPmHead2: target.expectedPmHead2 ?? target.expectedPmPerHead ?? 3,
      hasPi5: target.hasPi5 ?? true,
      mqttTopics:       { ...EMPTY_STATION.mqttTopics,       ...(target.mqttTopics       || {}) },
      mongoCollections: { ...EMPTY_STATION.mongoCollections, ...(target.mongoCollections || {}) },
      telegram:         { ...EMPTY_STATION.telegram,         ...(target.telegram         || {}) },
    });
    setMode('edit');
  }, [editId, stations]);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const setTopic   = (key: keyof Station['mqttTopics'],       val: string) =>
    setForm(f => ({ ...f, mqttTopics:       { ...f.mqttTopics,       [key]: val } }));
  const setMongo   = (key: keyof Station['mongoCollections'], val: string) =>
    setForm(f => ({ ...f, mongoCollections: { ...f.mongoCollections, [key]: val } }));
  const setTelegram = (key: keyof Station['telegram'], val: string | boolean) =>
    setForm(f => ({ ...f, telegram: { ...f.telegram, [key]: val } }));

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Mongo collection name rules — must match server-side VALID_NAME_RE
  const NAME_RE = /^[A-Za-z0-9_-]{1,80}$/;

  const handleSave = async () => {
    setSaveError(null);
    const trimmedName = form.name.trim();
    if (!trimmedName) {
      setSaveError('Station name is required');
      return;
    }
    if (!NAME_RE.test(trimmedName)) {
      setSaveError('Station name may only contain letters, digits, _ or - (no spaces or symbols)');
      return;
    }

    // Build the doc that will be saved.
    let stationDoc: Station;
    if (mode === 'edit' && form.id) {
      stationDoc = {
        ...form,
        name: trimmedName,
        id: form.id,
        createdAt: stations.find(s => s.id === form.id)?.createdAt ?? new Date().toISOString(),
      } as Station;
    } else {
      const newId = trimmedName.toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9-]/g, '');
      if (!newId) {
        setSaveError('Cannot derive station id from the given name');
        return;
      }
      // Block accidental overwrite when adding.
      const dupId   = stations.find(s => s.id === newId);
      const dupName = stations.find(s => s.name === trimmedName);
      if (dupId)   { setSaveError(`A station with id "${newId}" already exists. Use Edit instead.`); return; }
      if (dupName) { setSaveError(`A station with name "${trimmedName}" already exists.`); return; }
      stationDoc = {
        ...form,
        name: trimmedName,
        id: newId,
        createdAt: new Date().toISOString(),
      };
    }

    setSaving(true);
    let ok = false;
    try {
      const res = await fetch('/api/stations/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(stationDoc),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as any));
        setSaveError(body?.error || `Save failed: HTTP ${res.status}`);
      } else {
        ok = true;
      }
    } catch (err: any) {
      setSaveError(`Network error: ${err?.message || err}`);
    } finally {
      setSaving(false);
    }

    if (!ok) return;

    // Only mutate local state AFTER server confirms — no rollback bugs.
    if (mode === 'edit' && form.id) {
      setStations(prev => prev.map(s => s.id === form.id ? stationDoc : s));
    } else {
      setStations(prev => [...prev, stationDoc]);
    }

    setSaved(true);
    setTimeout(() => { setSaved(false); goToList(); }, 1500);
  };

  const [search, setSearch] = useState('');

  const filteredStations = search.trim() === ''
    ? stations
    : stations.filter(s => {
        const q = search.toLowerCase();
        return (
          (s.id          || '').toLowerCase().includes(q) ||
          (s.name        || '').toLowerCase().includes(q) ||
          (s.displayName || '').toLowerCase().includes(q) ||
          (s.location    || '').toLowerCase().includes(q)
        );
      });

  const handleDelete = async (id: string) => {
    setDeleteConfirm(null);
    try {
      const res = await fetch('/api/stations/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(`Delete failed: ${body?.error || res.status}`);
        return;
      }
      setStations(prev => prev.filter(s => s.id !== id));
    } catch (err: any) {
      alert(`Delete failed: ${err?.message || err}`);
    }
  };

  // ── PIN gate ────────────────────────────────────────────────────────────────
  if (authState === 'checking') {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
        Checking access...
      </div>
    );
  }

  if (authState === 'locked') {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '4rem' }}>
        <div className="card" style={{ width: '100%', maxWidth: 360, padding: '2rem' }}>
          <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%',
              background: 'var(--info-bg)', color: 'var(--info-text)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 26, marginBottom: 12,
            }}>
              ◔
            </div>
            <h1 className="section-title" style={{ fontSize: 18 }}>Station Config — Locked</h1>
            <p className="section-subtitle">Enter PIN to access configuration</p>
          </div>
          <form onSubmit={submitPin} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              className="input"
              placeholder="••••"
              value={pinInput}
              onChange={e => setPinInput(e.target.value)}
              style={{ fontSize: 18, letterSpacing: '0.4em', textAlign: 'center', padding: '12px 14px' }}
            />
            {pinError && (
              <div style={{ fontSize: 12, color: 'var(--error-text)', textAlign: 'center' }}>{pinError}</div>
            )}
            <button type="submit" className="btn btn-primary"
              disabled={!pinInput || pinSubmitting}
              style={{ opacity: pinInput && !pinSubmitting ? 1 : 0.5, justifyContent: 'center' }}>
              {pinSubmitting ? 'Verifying...' : 'Unlock'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── List ────────────────────────────────────────────────────────────────────
  if (mode === 'list') {
    return (
      <div>
        <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 className="section-title" style={{ fontSize: 18 }}>Station Config</h1>
            <p className="section-subtitle">
              {stations.length} stations configured
              {search.trim() && filteredStations.length !== stations.length && ` · ${filteredStations.length} shown`}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              className="input"
              placeholder="Search stations..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: 220, fontSize: 12 }}
            />
            <button className="btn btn-primary" onClick={() => { setForm({ ...EMPTY_STATION }); setMode('add'); }}>
              + Add Station
            </button>
            <button className="btn btn-secondary btn-sm" onClick={logout} title="Lock config">
              ◔ Lock
            </button>
          </div>
        </div>

        {filteredStations.length === 0 && search.trim() && (
          <div className="card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
            No stations match &quot;{search}&quot;
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {filteredStations.map(station => (
            <div key={station.id} className="card" style={{ padding: '1rem 1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{station.displayName || station.name}</span>
                    <span className="badge badge-info" style={{ fontSize: 10 }}>{station.name}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {station.chargerHeads} heads · Fan {station.fanBrand} · HMI {station.hmiBrand || 'Phoenix'} · Controller {(station.controllerType || 'phoenix') === 'vector' ? 'Vector' : 'Phoenix'}
                    </span>
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
                      hasPi5: station.hasPi5 ?? true,
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
        <button className="btn btn-secondary btn-sm" onClick={goToList}>← Back</button>
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
            <div style={{ display: 'grid', gridTemplateColumns: form.chargerHeads >= 2 ? '1fr 1fr' : '1fr', gap: '0.75rem' }}>
              <div>
                <label className="input-label">{form.chargerHeads >= 2 ? 'Expected PM — Head 1' : 'Expected PM'}</label>
                <input className="input" type="number" min={1} max={10}
                  value={form.expectedPmHead1 ?? 3}
                  onChange={e => setForm(f => ({ ...f, expectedPmHead1: Number(e.target.value) }))}
                />
              </div>
              {form.chargerHeads >= 2 && (
                <div>
                  <label className="input-label">Expected PM — Head 2</label>
                  <input className="input" type="number" min={1} max={10}
                    value={form.expectedPmHead2 ?? 3}
                    onChange={e => setForm(f => ({ ...f, expectedPmHead2: Number(e.target.value) }))}
                  />
                </div>
              )}
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
            <div>
              <label className="input-label">HMI Brand</label>
              <select className="input"
                value={form.hmiBrand || 'Phoenix'}
                onChange={e => setForm(f => ({ ...f, hmiBrand: e.target.value as 'Phoenix' | 'DWIN' }))}
              >
                <option value="Phoenix">Phoenix</option>
                <option value="DWIN">DWIN</option>
              </select>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                DWIN displays don&apos;t report active/inactive — Device Status page will skip HMI checks for these
              </div>
            </div>
            <div>
              <label className="input-label">Controller Type</label>
              <select className="input"
                value={form.controllerType || 'phoenix'}
                onChange={e => setForm(f => ({ ...f, controllerType: e.target.value as 'phoenix' | 'vector' }))}
              >
                <option value="phoenix">Phoenix (legacy — separate topics)</option>
                <option value="vector">Vector (single state topic)</option>
              </select>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                Vector controllers publish PLC + PowerModule + temps + isolation in ONE topic. For Vector you should also set HMI Brand to DWIN.
              </div>
            </div>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '6px 0' }}>
                <input type="checkbox"
                  checked={form.hasPi5 ?? true}
                  onChange={e => setForm(f => ({ ...f, hasPi5: e.target.checked }))}
                  style={{ accentColor: 'var(--info)', width: 16, height: 16 }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                  Station has Pi5 device
                </span>
              </label>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, marginLeft: 24 }}>
                Uncheck if this station has no Pi5 — heartbeat panel will hide Pi5 row
              </div>
            </div>
          </div>
        </div>

        {/* ── MQTT Topics ── */}
        <div className="card">
          <SectionHeader icon="⇆" title="MQTT Topics" subtitle={
            form.controllerType === 'vector'
              ? 'Vector controller — uses ONE combined state topic for PLC + PowerModule + temps'
              : 'Topics subscribed on the MQTT broker'
          } />
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

            {form.controllerType === 'vector' ? (
              <InputRow label="Vector State Topic"
                value={form.mqttTopics.vectorState || ''} onChange={v => setTopic('vectorState' as any, v)}
                placeholder="ev/STID/vector/state"
                hint="Single Vector payload — connectors, power_module, temps, isolation, contactor, emergency" />
            ) : (
              <>
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
              </>
            )}
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
      <div style={{ marginTop: '1.5rem', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={handleSave}
          disabled={!form.name.trim() || saving} style={{ opacity: form.name.trim() && !saving ? 1 : 0.5 }}>
          {saving ? 'Saving...' : `✓ ${mode === 'add' ? 'Add Station' : 'Save Changes'}`}
        </button>
        <button className="btn btn-secondary" onClick={goToList}>Cancel</button>
        {saveError && (
          <span style={{
            padding: '6px 12px',
            background: 'var(--error-bg)',
            border: '1px solid var(--error)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--error-text)',
            fontSize: 12,
            fontWeight: 600,
          }}>
            ⚠ {saveError}
          </span>
        )}
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

export default function ConfigPage() {
  return (
    <Suspense fallback={
      <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
        Loading...
      </div>
    }>
      <ConfigPageInner />
    </Suspense>
  );
}
