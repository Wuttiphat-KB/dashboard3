import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const COOKIE_NAME = 'cfg_pin';
const COOKIE_MAX_AGE = 8 * 3600;  // 8 hours

function getPin(): string {
  return process.env.CONFIG_PIN || '';
}

/** GET — check if current cookie is valid */
export async function GET() {
  const pin = getPin();
  if (!pin) return NextResponse.json({ ok: true, unprotected: true });

  const jar = await cookies();
  const cookie = jar.get(COOKIE_NAME);
  return NextResponse.json({ ok: cookie?.value === pin });
}

/** POST — submit PIN, set cookie if correct */
export async function POST(req: NextRequest) {
  const expected = getPin();
  if (!expected) return NextResponse.json({ ok: true, unprotected: true });

  const body = await req.json().catch(() => ({}));
  const submitted = String(body.pin || '');

  if (submitted !== expected) {
    return NextResponse.json({ ok: false, error: 'Incorrect PIN' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, expected, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
  return res;
}

/** DELETE — logout, clear cookie */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return res;
}
