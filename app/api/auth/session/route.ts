import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, verifyToken } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const session = await verifyToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ username: session.username, role: session.role }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
