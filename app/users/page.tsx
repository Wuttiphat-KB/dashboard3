'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSessionAccess } from '@/components/SessionProvider';

type Role = 'admin' | 'customer';

interface User {
  username: string;
  role: Role;
  customer?: string;
  displayName?: string;
  disabled?: boolean;
  createdAt?: string;
  createdBy?: string;
  lastLoginAt?: string;
}

interface Customer { name: string; stationCount: number; userCount?: number; registered?: boolean; createdAt?: string; createdBy?: string }

interface FormState {
  mode: 'create' | 'edit';
  username: string;
  displayName: string;
  role: Role;
  customer: string;
  password: string;
  disabled: boolean;
}

const EMPTY_FORM: FormState = { mode: 'create', username: '', displayName: '', role: 'customer', customer: '', password: '', disabled: false };

const PERMISSIONS: { label: string; admin: boolean; customer: string | boolean }[] = [
  { label: 'View dashboard, stations, alerts, maps', admin: true, customer: 'own customer only' },
  { label: 'Energy Usage / Peak Hours + Export CSV',   admin: true, customer: 'own customer only' },
  { label: 'Acknowledge alerts',                       admin: true, customer: false },
  { label: 'Station Config / Settings',                admin: true, customer: false },
  { label: 'vSECC Manager Log (view / download)',      admin: true, customer: 'own customer only' },
  { label: 'Users & Roles / Audit Log',                admin: true, customer: false },
];

function fmtDate(v?: string) {
  if (!v) return '—';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('en-GB', { timeZone: 'Asia/Bangkok', hour12: false });
}

export default function UsersPage() {
  const { isAdmin, loading: sessionLoading, username: me } = useSessionAccess();
  const [users, setUsers] = useState<User[] | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [builtInAdmin, setBuiltInAdmin] = useState('');
  const [minPw, setMinPw] = useState(8);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'users' | 'customers'>('users');
  const [newCustomer, setNewCustomer] = useState('');
  const [custSaving, setCustSaving] = useState(false);
  const [custError, setCustError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    fetch('/api/users', { cache: 'no-store' })
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`); return j; })
      .then(j => { setUsers(j.users); setCustomers(j.customers || []); setBuiltInAdmin(j.builtInAdmin || ''); setMinPw(j.minPasswordLength || 8); })
      .catch(err => setError(err.message));
  }, []);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (users || []).filter(u => !q || [u.username, u.displayName, u.customer, u.role].some(v => v?.toLowerCase().includes(q)));
  }, [users, search]);

  const stationCount = (name?: string) => customers.find(c => c.name === name)?.stationCount ?? 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setFormError(null);
    try {
      const body: any = form.mode === 'create'
        ? { role: form.role }
        : { displayName: form.displayName, role: form.role, disabled: form.disabled };
      if (form.mode === 'edit' && form.role === 'customer') body.customer = form.customer;
      if (form.password) body.password = form.password;
      const res = form.mode === 'create'
        ? await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, username: form.username }) })
        : await fetch(`/api/users/${encodeURIComponent(form.username)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      setForm(null);
      load();
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(u: User) {
    if (!window.confirm(`Delete user "${u.username}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/users/${encodeURIComponent(u.username)}`, { method: 'DELETE' });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setError(j?.error || `HTTP ${res.status}`); return; }
    load();
  }

  async function toggleDisabled(u: User) {
    const res = await fetch(`/api/users/${encodeURIComponent(u.username)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ disabled: !u.disabled }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setError(j?.error || `HTTP ${res.status}`); return; }
    load();
  }

  async function addCustomer(nameRaw: string) {
    const name = nameRaw.trim();
    if (!name) return;
    setCustSaving(true);
    setCustError(null);
    try {
      const res = await fetch('/api/customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      setNewCustomer('');
      load();
    } catch (err: any) {
      setCustError(err.message);
    } finally {
      setCustSaving(false);
    }
  }

  async function removeCustomer(c: Customer) {
    const used = c.stationCount || c.userCount
      ? `\n\nStill used by ${c.stationCount} station(s) and ${c.userCount ?? 0} user(s) — they keep this name; it is only removed from the list.`
      : '';
    if (!window.confirm(`Remove customer "${c.name}" from the list?${used}`)) return;
    setCustError(null);
    const res = await fetch(`/api/customers/${encodeURIComponent(c.name)}`, { method: 'DELETE' });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setCustError(j?.error || `HTTP ${res.status}`); return; }
    load();
  }

  if (sessionLoading) return <div className="card" style={{ padding: '2rem', textAlign: 'center' }}><span className="spinner" /></div>;
  if (!isAdmin) return <div className="card">This page is available to administrators only.</div>;

  const label = { fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.05em' };
  const th = { padding: '8px 10px', fontWeight: 600, textAlign: 'left' as const, whiteSpace: 'nowrap' as const };
  const td = { padding: '8px 10px', verticalAlign: 'top' as const };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <div>
          <h1 className="section-title" style={{ fontSize: 18 }}>Users &amp; Roles</h1>
          <p className="section-subtitle">Accounts that can sign in to the dashboard, their role and which customer&apos;s stations they see</p>
        </div>
        {tab === 'users' && (
          <button className="btn btn-primary" onClick={() => { setFormError(null); setForm({ ...EMPTY_FORM }); }}>
            + Add user
          </button>
        )}
      </div>

      <div className="tabs" style={{ marginBottom: '1rem' }}>
        <button className={`tab ${tab === 'users' ? 'tab-active' : ''}`} onClick={() => setTab('users')}>
          Users{users ? ` (${users.length + 1})` : ''}
        </button>
        <button className={`tab ${tab === 'customers' ? 'tab-active' : ''}`} onClick={() => setTab('customers')}>
          Customers ({customers.length})
        </button>
      </div>

      {error && (
        <div className="card" style={{ padding: '0.875rem 1rem', borderColor: 'var(--error)', color: 'var(--error-text)', marginBottom: '1rem', fontSize: 12 }}>
          {error}
        </div>
      )}

      {tab === 'customers' && (
        <div className="card">
          <div className="card-header"><span className="card-title">Customers</span></div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 0.75rem' }}>
            Add customer names here, then pick them in Station Config → Customer and when editing a Customer user.
            The name must match exactly for a user to see that customer&apos;s stations.
          </p>
          <form onSubmit={e => { e.preventDefault(); addCustomer(newCustomer); }}
            style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <input className="input" required maxLength={200} value={newCustomer} placeholder="Customer name"
              onChange={e => setNewCustomer(e.target.value)} style={{ flex: '1 1 220px', maxWidth: 360 }} />
            <button type="submit" className="btn btn-primary" disabled={custSaving || !newCustomer.trim()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {custSaving && <span className="spinner" style={{ width: 12, height: 12 }} />}
              + Add customer
            </button>
          </form>
          {custError && <div style={{ color: 'var(--error-text)', fontSize: 12, marginBottom: '0.75rem' }}>{custError}</div>}
          {!users && !error && <div style={{ padding: '2rem', textAlign: 'center' }}><span className="spinner" /></div>}
          {users && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                    <th style={th}>Customer</th>
                    <th style={th}>Stations</th>
                    <th style={th}>Users</th>
                    <th style={th}>Added</th>
                    <th style={{ ...th, textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map(c => (
                    <tr key={c.name} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={td}>{c.name}</td>
                      <td style={td}>{c.stationCount}</td>
                      <td style={td}>{c.userCount ?? 0}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        {c.registered ? <>{fmtDate(c.createdAt)}{c.createdBy && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>by {c.createdBy}</div>}</>
                          : <span style={{ fontSize: 11, color: 'var(--warn-text)' }}>Found on stations only</span>}
                      </td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {c.registered
                          ? <button className="btn btn-danger btn-sm" onClick={() => removeCustomer(c)}>Remove</button>
                          : <button className="btn btn-secondary btn-sm" disabled={custSaving} onClick={() => addCustomer(c.name)}>Add to list</button>}
                      </td>
                    </tr>
                  ))}
                  {customers.length === 0 && (
                    <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: 'var(--text-muted)', padding: '1.5rem' }}>
                      No customers yet — add one above.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'users' && (<>
      {/* Role permission matrix */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="card-header"><span className="card-title">Role permissions</span></div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                <th style={th}>Permission</th>
                <th style={{ ...th, textAlign: 'center' }}>Admin</th>
                <th style={{ ...th, textAlign: 'center' }}>Customer</th>
              </tr>
            </thead>
            <tbody>
              {PERMISSIONS.map(p => (
                <tr key={p.label} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={td}>{p.label}</td>
                  <td style={{ ...td, textAlign: 'center', color: 'var(--ok-text)' }}>✓</td>
                  <td style={{ ...td, textAlign: 'center', color: p.customer ? 'var(--ok-text)' : 'var(--text-muted)' }}>
                    {p.customer === false ? '—' : p.customer === true ? '✓' : `✓ ${p.customer}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Users table */}
      <div className="card">
        <div className="card-header" style={{ gap: 12, flexWrap: 'wrap' }}>
          <span className="card-title">Users {users ? `(${users.length + 1})` : ''}</span>
          <input className="input" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)}
            style={{ maxWidth: 220, padding: '4px 8px', fontSize: 11 }} />
        </div>
        {!users && !error && <div style={{ padding: '2rem', textAlign: 'center' }}><span className="spinner" /></div>}
        {users && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                  <th style={th}>Username</th>
                  <th style={th}>Role</th>
                  <th style={th}>Customer scope</th>
                  <th style={th}>Status</th>
                  <th style={th}>Last login</th>
                  <th style={th}>Created</th>
                  <th style={{ ...th, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {builtInAdmin && !search && (
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={td}><span style={{ fontFamily: 'monospace' }}>{builtInAdmin}</span>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>built-in (.env.local)</div></td>
                    <td style={td}><span className="badge badge-info">Admin</span></td>
                    <td style={{ ...td, color: 'var(--text-muted)' }}>All stations</td>
                    <td style={td}><span className="badge badge-ok">Active</span></td>
                    <td style={{ ...td, color: 'var(--text-muted)' }}>—</td>
                    <td style={{ ...td, color: 'var(--text-muted)' }}>—</td>
                    <td style={{ ...td, textAlign: 'right', color: 'var(--text-muted)', fontSize: 11 }}>change in .env.local</td>
                  </tr>
                )}
                {shown.map(u => (
                  <tr key={u.username} style={{ borderBottom: '1px solid var(--border-subtle)', opacity: u.disabled ? 0.6 : 1 }}>
                    <td style={td}>
                      <span style={{ fontFamily: 'monospace' }}>{u.username}</span>
                      {u.username === me && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}> (you)</span>}
                      {u.displayName && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{u.displayName}</div>}
                    </td>
                    <td style={td}><span className={`badge ${u.role === 'admin' ? 'badge-info' : 'badge-warn'}`}>{u.role === 'admin' ? 'Admin' : 'Customer'}</span></td>
                    <td style={td}>
                      {u.role === 'admin' ? <span style={{ color: 'var(--text-muted)' }}>All stations</span> : (
                        <>
                          {u.customer || <span style={{ color: 'var(--warn-text)' }}>Not assigned</span>}
                          {u.customer && <div style={{ fontSize: 10, color: stationCount(u.customer) ? 'var(--text-muted)' : 'var(--warn-text)' }}>
                            {stationCount(u.customer)} station{stationCount(u.customer) === 1 ? '' : 's'}
                          </div>}
                        </>
                      )}
                    </td>
                    <td style={td}><span className={`badge ${u.disabled ? 'badge-error' : 'badge-ok'}`}>{u.disabled ? 'Disabled' : 'Active'}</span></td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDate(u.lastLoginAt)}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDate(u.createdAt)}{u.createdBy && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>by {u.createdBy}</div>}</td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => {
                        setFormError(null);
                        setForm({ mode: 'edit', username: u.username, displayName: u.displayName || '', role: u.role, customer: u.customer || '', password: '', disabled: !!u.disabled });
                      }}>Edit</button>{' '}
                      {u.username !== me && (
                        <>
                          <button className="btn btn-secondary btn-sm" onClick={() => toggleDisabled(u)}>{u.disabled ? 'Enable' : 'Disable'}</button>{' '}
                          <button className="btn btn-danger btn-sm" onClick={() => remove(u)}>Delete</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: 'var(--text-muted)', padding: '1.5rem' }}>
                    No users yet — click “+ Add user” to create one.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      </>)}

      {/* Create / edit dialog */}
      {form && (
        <div role="dialog" aria-modal="true" onClick={() => !saving && setForm(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <form className="card" onClick={e => e.stopPropagation()} onSubmit={submit}
            style={{ width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 12, padding: '1.25rem' }}>
            <div className="card-title" style={{ fontSize: 14 }}>{form.mode === 'create' ? 'Add user' : `Edit ${form.username}`}</div>

            {form.mode === 'create' && (
              <div>
                <label className="input-label">Username</label>
                <input className="input" required autoFocus value={form.username} autoComplete="off"
                  onChange={e => setForm({ ...form, username: e.target.value })} placeholder="e.g. pt.operator"
                  style={{ fontFamily: 'monospace' }} />
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>3–64 characters: letters, digits, . _ @ - (stored lowercase)</div>
              </div>
            )}

            {form.mode === 'edit' && (
              <div>
                <label className="input-label">Display name (optional)</label>
                <input className="input" value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })} />
              </div>
            )}

            <div>
              <label className="input-label">{form.mode === 'create' ? 'Password' : 'New password (leave blank to keep)'}</label>
              <input className="input" type="password" autoComplete="new-password" minLength={form.mode === 'create' || form.password ? minPw : undefined}
                required={form.mode === 'create'} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>At least {minPw} characters</div>
            </div>

            <div>
              <label className="input-label">Role</label>
              <select className="input" value={form.role} onChange={e => setForm({ ...form, role: e.target.value as Role })}>
                <option value="customer">Customer — read only, own customer&apos;s stations</option>
                <option value="admin">Admin — full access</option>
              </select>
            </div>

            {form.mode === 'edit' && form.role === 'customer' && (
              <div>
                <label className="input-label">Customer (optional)</label>
                <input className="input" list="customer-names" value={form.customer}
                  onChange={e => setForm({ ...form, customer: e.target.value })} placeholder="Customer name as set on stations" />
                <datalist id="customer-names">
                  {customers.map(c => <option key={c.name} value={c.name}>{`${c.stationCount} stations`}</option>)}
                </datalist>
                <div style={{ fontSize: 10, color: stationCount(form.customer) ? 'var(--text-muted)' : 'var(--warn-text)', marginTop: 3 }}>
                  {form.customer
                    ? `${stationCount(form.customer)} station(s) have Customer = "${form.customer}" in Station Config (exact match)`
                    : 'Not assigned — this user sees no stations until a customer is set'}
                </div>
              </div>
            )}

            {form.mode === 'edit' && form.username !== me && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.disabled} onChange={e => setForm({ ...form, disabled: e.target.checked })} />
                Disabled (cannot sign in; active sessions end within ~30 s)
              </label>
            )}

            {formError && <div style={{ color: 'var(--error-text)', fontSize: 12 }}>{formError}</div>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setForm(null)} disabled={saving}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {saving && <span className="spinner" style={{ width: 12, height: 12 }} />}
                {form.mode === 'create' ? 'Create user' : 'Save changes'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
