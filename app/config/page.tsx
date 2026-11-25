'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useStations } from '@/lib/hooks/useStations';
import { invalidateStations } from '@/lib/hooks/dataCache';
import { Station } from '@/lib/types';
import { trimCustomerInfo, validateCustomerInfo } from '@/lib/customerInfo';
import { trimChargeBoxId, validateChargeBoxId, CHARGE_BOX_ID_MAX_LENGTH } from '@/lib/chargeBoxId';
import {
  describeWarranty, formatWarrantyDate, formatWarrantyYears, normalizeWarrantyYears, todayInBangkok,
  trimCommissioningDate, validateCommissioningDate, validateWarrantyYears, warrantyStatus,
  WARRANTY_YEARS_MAX, WARRANTY_YEARS_STEP,
} from '@/lib/warranty';
import { ZerotierCopy } from '@/components/ui/CopyButton';
import WarrantyBadge from '@/components/ui/WarrantyBadge';
import { useSessionAccess } from '@/components/SessionProvider';

type WarrantyFilter = 'all' | 'expired' | 'active' | 'unknown';

const EMPTY_STATION: Omit<Station, 'id' | 'createdAt'> = {
  name: '',
  displayName: '',
  location: '',
  customer: {},
  lat: undefined,
  lng: undefined,
  zerotierIp: '',
  chargeBoxId: '',
  commissioningDate: '',
  warrantyYears: null,
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
  const { canEdit, loading: sessionLoading } = useSessionAccess();
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

  // Customer names registered on Users & Roles → Customers (suggestions for the Customer field).
  const [customerNames, setCustomerNames] = useState<string[]>([]);
  useEffect(() => {
    fetch('/api/customers', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : { customers: [] }))
      .then(j => setCustomerNames((j.customers || []).map((c: { name: string }) => c.name)))
      .catch(() => {});
  }, []);

  const goToList = () => {
    setMode('list');
    if (editId) router.replace('/config');  // clear ?edit= from URL
  };

  // Auto-open edit form when ?edit=<id> is in URL (link from station detail page).
  // Do this ONCE per id. `stations` is replaced by every background refetch of
  // /api/stations (every ~10-30 s) and again right after a save; re-running this
  // on each change used to overwrite everything the user had typed with the
  // saved copy of the station.
  const openedEditIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!editId) { openedEditIdRef.current = null; return; }  // ?edit= cleared → allow reopening later
    if (openedEditIdRef.current === editId) return;            // already opened — keep the user's input
    if (stations.length === 0) return;
    const target = stations.find(s => s.id === editId || s.name === editId);
    if (!target) return;
    openedEditIdRef.current = editId;
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
    const customerError = validateCustomerInfo(form.customer);
    if (customerError) {
      setSaveError(customerError);
      return;
    }
    const chargeBoxError = validateChargeBoxId(form.chargeBoxId);
    if (chargeBoxError) {
      setSaveError(chargeBoxError);
      return;
    }
    const warrantyError = validateCommissioningDate(form.commissioningDate) || validateWarrantyYears(form.warrantyYears);
    if (warrantyError) {
      setSaveError(warrantyError);
      return;
    }
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
        customer: trimCustomerInfo(form.customer),
        chargeBoxId: trimChargeBoxId(form.chargeBoxId),
        commissioningDate: trimCommissioningDate(form.commissioningDate),
        warrantyYears: normalizeWarrantyYears(form.warrantyYears),
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
        customer: trimCustomerInfo(form.customer),
        chargeBoxId: trimChargeBoxId(form.chargeBoxId),
        commissioningDate: trimCommissioningDate(form.commissioningDate),
        warrantyYears: normalizeWarrantyYears(form.warrantyYears),
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

    // Refresh the shared client cache so other pages (e.g. Station Map) pick up
    // the change immediately instead of waiting for the stale window to expire.
    invalidateStations();

    setSaved(true);
    setTimeout(() => { setSaved(false); goToList(); }, 1500);
  };

  const [search, setSearch] = useState('');
  const [warrantyFilter, setWarrantyFilter] = useState<WarrantyFilter>('all');

  // One "today" per render so every card and the filter counts agree.
  const today = todayInBangkok();
  const warrantyOf = (s: Station) => warrantyStatus(s.commissioningDate, s.warrantyYears, today);
  const warrantyCounts = { all: stations.length, expired: 0, active: 0, unknown: 0 };
  for (const s of stations) warrantyCounts[warrantyOf(s).state]++;

  const searchedStations = search.trim() === ''
    ? stations
    : stations.filter(s => {
        const q = search.trim().toLowerCase();
        return (
          (s.id          || '').toLowerCase().includes(q) ||
          (s.name        || '').toLowerCase().includes(q) ||
          (s.displayName || '').toLowerCase().includes(q) ||
          (s.location    || '').toLowerCase().includes(q) ||
          (s.customer?.name || '').toLowerCase().includes(q) ||
          (s.chargeBoxId || '').toLowerCase().includes(q)
        );
      });
  const filteredStations = warrantyFilter === 'all'
    ? searchedStations
    : searchedStations.filter(s => warrantyOf(s).state === warrantyFilter);

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
  if (sessionLoading || !canEdit) {
    return <div className="card">{sessionLoading ? 'Checking access...' : 'This account has read-only access'}</div>;
  }
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
              {filteredStations.length !== stations.length && ` · ${filteredStations.length} shown`}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              className="input"
              placeholder="Search station, customer, ChargeBox ID..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: 260, fontSize: 12 }}
            />
            <button className="btn btn-primary" onClick={() => { setForm({ ...EMPTY_STATION }); setMode('add'); }}>
              + Add Station
            </button>
            <button className="btn btn-secondary btn-sm" onClick={logout} title="Lock config">
              ◔ Lock
            </button>
          </div>
        </div>

        {/* Warranty filter — "หมดประกันแล้ว" lists every station whose warranty has ended */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: '1rem' }}>
          {([
            { id: 'all',     label: 'ทั้งหมด',        tone: 'info'  },
            { id: 'expired', label: 'หมดประกันแล้ว', tone: 'error' },
            { id: 'active',  label: 'อยู่ในประกัน',   tone: 'ok'    },
            { id: 'unknown', label: 'ยังไม่ระบุ',     tone: 'info'  },
          ] as const).map(f => {
            const on = warrantyFilter === f.id;
            return (
              <button key={f.id} type="button" onClick={() => setWarrantyFilter(f.id)} aria-pressed={on}
                style={{
                  padding: '4px 12px', fontSize: 11, fontFamily: 'var(--font-geist-mono), monospace',
                  borderRadius: 999, cursor: 'pointer',
                  border: `1px solid ${on ? `var(--${f.tone})` : 'var(--border)'}`,
                  background: on ? `var(--${f.tone}-bg)` : 'transparent',
                  color: on ? `var(--${f.tone}-text)` : 'var(--text-secondary)',
                  fontWeight: on ? 700 : 400,
                }}>
                {f.label} {warrantyCounts[f.id]}
              </button>
            );
          })}
        </div>

        {filteredStations.length === 0 && stations.length > 0 && (
          <div className="card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
            {search.trim()
              ? <>No stations match &quot;{search}&quot;{warrantyFilter !== 'all' && ' in this warranty filter'}</>
              : 'No stations in this warranty filter'}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {filteredStations.map(station => (
            <div key={station.id} className="card" style={{ padding: '1rem 1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{station.displayName || station.name}</span>
                    <ZerotierCopy ip={station.zerotierIp} />
                    <span className="badge badge-info" style={{ fontSize: 10 }}>{station.name}</span>
                    <WarrantyBadge commissioningDate={station.commissioningDate} warrantyYears={station.warrantyYears} showActive />
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {station.chargerHeads} heads · Fan {station.fanBrand} · HMI {station.hmiBrand || 'Phoenix'} · Controller {(station.controllerType || 'phoenix') === 'vector' ? 'Vector' : 'Phoenix'}
                    </span>
                  </div>
                  {station.customer?.name && (
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, overflowWrap: 'anywhere' }}>
                      <span style={{ fontWeight: 600 }}>Customer: </span>
                      {station.customer.name}
                    </div>
                  )}
                  {station.chargeBoxId && (
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, overflowWrap: 'anywhere' }}>
                      <span style={{ fontWeight: 600 }}>ChargeBox ID: </span>
                      <span style={{ fontFamily: 'var(--font-geist-mono), monospace' }}>{station.chargeBoxId}</span>
                    </div>
                  )}
                  {(station.commissioningDate || station.warrantyYears != null) && (() => {
                    const w = warrantyOf(station);
                    return (
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, overflowWrap: 'anywhere' }}>
                        <span style={{ fontWeight: 600 }}>Commissioning: </span>{station.commissioningDate ? formatWarrantyDate(station.commissioningDate) : '—'}
                        {' · '}<span style={{ fontWeight: 600 }}>ประกัน </span>{station.warrantyYears != null ? formatWarrantyYears(station.warrantyYears) : '—'}
                        {w.state !== 'unknown' && w.expiresOn && w.daysLeft !== null && (
                          <>
                            {' · '}<span style={{ fontWeight: 600 }}>{w.state === 'expired' ? 'หมดประกัน ' : 'ประกันถึง '}</span>{formatWarrantyDate(w.expiresOn)}
                            {' '}<span style={{ color: w.state === 'expired' ? 'var(--error-text)' : 'var(--text-muted)' }}>
                              ({w.state === 'expired' ? `เกินมา ${-w.daysLeft} วัน` : w.daysLeft === 0 ? 'วันสุดท้าย' : `เหลืออีก ${w.daysLeft} วัน`})
                            </span>
                          </>
                        )}
                      </div>
                    );
                  })()}
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
          <p className="section-subtitle">Configure customer information, MQTT topics, MongoDB collections, and Telegram</p>
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
            <div>
              <label className="input-label" htmlFor="customer-name">Customer</label>
              <input id="customer-name" className="input" type="text" maxLength={200}
                list="customer-name-options"
                placeholder="ชื่อลูกค้า"
                value={form.customer?.name ?? ''}
                onChange={e => setForm(f => ({ ...f, customer: { ...f.customer, name: e.target.value } }))} />
              <datalist id="customer-name-options">
                {customerNames.map(n => <option key={n} value={n} />)}
              </datalist>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                เลือกจากรายชื่อใน Users &amp; Roles → Customers
              </div>
            </div>
            <InputRow label="Location" value={form.location} onChange={v => setForm(f => ({ ...f, location: v }))} placeholder="e.g. Bangkok – Siam Paragon" mono={false} />
            <div>
              <label className="input-label">Map Coordinates (Latitude / Longitude)</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <input className="input" type="number" step="any" inputMode="decimal"
                  placeholder="Lat e.g. 13.7563"
                  value={form.lat ?? ''}
                  onChange={e => setForm(f => ({ ...f, lat: e.target.value === '' ? undefined : Number(e.target.value) }))}
                  style={{ fontFamily: 'var(--font-geist-mono), monospace' }} />
                <input className="input" type="number" step="any" inputMode="decimal"
                  placeholder="Lng e.g. 100.5018"
                  value={form.lng ?? ''}
                  onChange={e => setForm(f => ({ ...f, lng: e.target.value === '' ? undefined : Number(e.target.value) }))}
                  style={{ fontFamily: 'var(--font-geist-mono), monospace' }} />
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                Decimal degrees — shown as a pin on the Station Maps page. Leave blank to auto-locate from the Location text.
              </div>
            </div>
            <InputRow label="ZeroTier IP"
              value={form.zerotierIp ?? ''} onChange={v => setForm(f => ({ ...f, zerotierIp: v }))}
              placeholder="e.g. 10.147.20.13" mono={true}
              hint="Remote-access address on the ZeroTier network — shown with a copy button on the station page" />
            <div>
              <label className="input-label" htmlFor="charge-box-id">ChargeBox ID</label>
              <input id="charge-box-id" className="input" type="text"
                autoComplete="off" spellCheck={false}
                placeholder="e.g. EGAT-BKK-003"
                value={form.chargeBoxId ?? ''}
                onChange={e => setForm(f => ({ ...f, chargeBoxId: e.target.value }))}
                style={{ fontFamily: 'var(--font-geist-mono), monospace' }} />
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                รหัส ChargeBox ID ของตู้ตามที่ตั้งไว้ใน OCPP (ไม่บังคับ · ไม่เกิน {CHARGE_BOX_ID_MAX_LENGTH} ตัวอักษร · ภาษาอังกฤษ/ตัวเลข/สัญลักษณ์ ไม่มีช่องว่าง)
              </div>
            </div>
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label className="input-label" htmlFor="commissioning-date">Commissioning Date</label>
                  <input id="commissioning-date" className="input" type="date"
                    min="2000-01-01" max="2100-12-31"
                    value={form.commissioningDate ?? ''}
                    onChange={e => setForm(f => ({ ...f, commissioningDate: e.target.value }))}
                    style={{ fontFamily: 'var(--font-geist-mono), monospace' }} />
                </div>
                <div>
                  <label className="input-label" htmlFor="warranty-years">Warranty (years)</label>
                  <input id="warranty-years" className="input" type="number"
                    min={WARRANTY_YEARS_STEP} max={WARRANTY_YEARS_MAX} step={WARRANTY_YEARS_STEP} inputMode="decimal"
                    placeholder="e.g. 3"
                    value={form.warrantyYears ?? ''}
                    onChange={e => setForm(f => ({ ...f, warrantyYears: e.target.value === '' ? null : Number(e.target.value) }))}
                    style={{ fontFamily: 'var(--font-geist-mono), monospace' }} />
                </div>
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                วันที่เริ่มใช้งานสถานี และระยะเวลารับประกันเป็นปี นับจากวัน commissioning (ไม่บังคับ · ครึ่งปีใส่ 0.5 · ต้องกรอกทั้งสองช่องจึงจะคำนวณวันหมดประกัน)
              </div>
              {(() => {
                const warrantyFormError = validateCommissioningDate(form.commissioningDate) || validateWarrantyYears(form.warrantyYears);
                const w = warrantyStatus(form.commissioningDate, form.warrantyYears, today);
                const tone = warrantyFormError ? 'error' : w.state === 'expired' ? 'error' : w.state === 'active' ? 'ok' : null;
                return (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, padding: '8px 10px', borderRadius: 6, fontSize: 12,
                    background: tone ? `var(--${tone}-bg)` : 'var(--bg-elevated)',
                    border: `1px solid ${tone ? `var(--${tone})` : 'var(--border)'}`,
                    color: tone ? `var(--${tone}-text)` : 'var(--text-muted)',
                  }}>
                    {tone && <span className={`led led-${tone}`} style={{ width: 7, height: 7 }} />}
                    <span>
                      {warrantyFormError
                        ? warrantyFormError
                        : w.state === 'unknown'
                          ? 'ยังไม่ระบุ — กรอกวันที่และจำนวนปีเพื่อคำนวณวันหมดประกัน'
                          : <><b>{w.state === 'expired' ? 'หมดประกันแล้ว' : 'อยู่ในประกัน'}</b> {describeWarranty(w)}</>}
                    </span>
                  </div>
                );
              })()}
            </div>
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
            {form.controllerType === 'vector' && (
              <InputRow label="vSECC API URL (Manager Log)"
                value={form.vseccApiUrl ?? ''} onChange={v => setForm(f => ({ ...f, vseccApiUrl: v }))}
                placeholder="e.g. http://10.147.20.13/api" mono={true}
                hint="Optional. Leave blank: the server joins this station's ZeroTier network automatically and uses http://192.168.3.11/api." />
            )}
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
