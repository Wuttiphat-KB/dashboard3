import { NextRequest, NextResponse } from 'next/server';
import { signToken, SESSION_COOKIE, nextDailyExpiry } from '@/lib/auth';
import { authenticate } from '@/lib/users';
import { audit, clientIp } from '@/lib/audit';

// Simple brute-force brake: 10 failures per IP+username within 15 min → 15 min lockout.
const WINDOW_MS = 15 * 60_000;
const MAX_FAILS = 10;
const g = globalThis as any;
const fails: Map<string, { n: number; first: number }> = g.__loginFails ??= new Map();

/**
 * POST /api/auth/login
 *
 * Body: { username, password }
 * Sets the auth_session httpOnly cookie on success.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const username = String(body?.username || '').trim();
    const password = String(body?.password || '');

    if (!username || !password) {
      return NextResponse.json({ error: 'username and password are required' }, { status: 400 });
    }

    const key = `${clientIp(req) || '?'}|${username.toLowerCase()}`;
    const f = fails.get(key);
    if (f && Date.now() - f.first < WINDOW_MS && f.n >= MAX_FAILS) {
      return NextResponse.json({ error: 'Too many failed attempts — try again in 15 minutes' }, { status: 429 });
    }

    const identity = await authenticate(username, password);
    if (!identity) {
      const cur = f && Date.now() - f.first < WINDOW_MS ? f : { n: 0, first: Date.now() };
      cur.n++;
      fails.set(key, cur);
      void audit({ username }, 'login_failed', { req, ok: false });
      // Same response shape regardless of which field is wrong — prevents user enumeration.
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
    }
    fails.delete(key);

    // Session expires at the next 07:00 Thailand time — same value drives both
    // the signed token and the cookie lifetime so they expire together.
    const expiresAt = nextDailyExpiry();
    const token = await signToken(identity, expiresAt);
    void audit(identity, 'login', { req });
    const res = NextResponse.json({ ok: true, username: identity.username, role: identity.role, customer: identity.customer ?? null });
    res.cookies.set({ name: 'cfg_pin', value: '', path: '/', maxAge: 0, httpOnly: true, sameSite: 'lax' });
    res.cookies.set({
      name: SESSION_COOKIE,
      value: token,
      httpOnly: true,
      sameSite: 'lax',
      // secure=true would block the cookie over http during dev / on LAN IPs.
      // The cookie value is HMAC-signed so it can't be forged regardless.
      secure: false,
      path: '/',
      maxAge: Math.max(1, Math.floor((expiresAt - Date.now()) / 1000)),
    });

    return res;
  } catch (err: any) {
    console.error('[api/auth/login] error:', err?.message || err);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}
