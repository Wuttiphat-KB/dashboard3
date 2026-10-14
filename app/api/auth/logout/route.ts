import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifyToken } from '@/lib/auth';
import { audit } from '@/lib/audit';

/** POST /api/auth/logout — clears the session cookie. */
export async function POST(req: NextRequest) {
  const session = await verifyToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (session) void audit(session, 'logout', { req });
  const jar = await cookies();
  jar.set({ name: 'cfg_pin', value: '', path: '/', maxAge: 0, httpOnly: true, sameSite: 'lax' });
  jar.set({
    name: SESSION_COOKIE,
    value: '',
    path: '/',
    maxAge: 0,
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
  });
  return NextResponse.json({ ok: true });
}
