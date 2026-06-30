import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { validateCredentials, signToken, SESSION_COOKIE, nextDailyExpiry } from '@/lib/auth';

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

    if (!validateCredentials(username, password)) {
      // Same response shape regardless of which field is wrong — prevents user enumeration.
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
    }

    // Session expires at the next 07:00 Thailand time — same value drives both
    // the signed token and the cookie lifetime so they expire together.
    const expiresAt = nextDailyExpiry();
    const token = await signToken(username, expiresAt);
    const jar = await cookies();
    jar.set({
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

    return NextResponse.json({ ok: true, username });
  } catch (err: any) {
    console.error('[api/auth/login] error:', err?.message || err);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}
