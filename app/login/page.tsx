'use client';

import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function LoginInner() {
  const search   = useSearchParams();
  const fromPath = search.get('from') || '/';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as any));
        setError(body?.error || `Login failed (HTTP ${res.status})`);
        return;
      }
      // Full page nav so middleware re-evaluates with the fresh cookie.
      window.location.href = fromPath;
    } catch (err: any) {
      setError(`Network error: ${err?.message || err}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1.5rem',
      background: 'var(--bg-base)',
    }}>
      <div className="card" style={{
        width: '100%',
        maxWidth: 380,
        padding: '2rem 1.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.25rem',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.25rem' }}>
          <img
            src="/flexxfast-logo.png"
            alt="FlexxFast"
            style={{ height: 56, width: 'auto', maxWidth: 260, objectFit: 'contain' }}
          />
        </div>

        <div style={{ textAlign: 'center' }}>
          <h1 className="section-title" style={{ fontSize: 16, marginBottom: 4 }}>Sign in</h1>
          <p className="section-subtitle" style={{ fontSize: 12 }}>
            Enter your credentials to access the dashboard
          </p>
        </div>

        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label className="input-label">Username</label>
            <input
              type="text"
              className="input"
              autoFocus
              autoComplete="username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="username"
              disabled={submitting}
              style={{ fontSize: 14 }}
            />
          </div>
          <div>
            <label className="input-label">Password</label>
            <input
              type="password"
              className="input"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              disabled={submitting}
              style={{ fontSize: 14 }}
            />
          </div>

          {error && (
            <div style={{
              padding: '8px 12px',
              background: 'var(--error-bg)',
              border: '1px solid var(--error)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--error-text)',
              fontSize: 12,
              fontWeight: 600,
              textAlign: 'center',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={!username.trim() || !password || submitting}
            style={{
              marginTop: 4,
              justifyContent: 'center',
              padding: '10px',
              fontSize: 13,
              fontWeight: 700,
              opacity: !username.trim() || !password || submitting ? 0.5 : 1,
            }}
          >
            {submitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
        Loading...
      </div>
    }>
      <LoginInner />
    </Suspense>
  );
}
