import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/lib/auth';

/** POST /api/auth/logout — clears the session cookie. */
export async function POST() {
  const jar = await cookies();
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
