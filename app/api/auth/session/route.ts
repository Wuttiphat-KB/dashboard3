import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession } from '@/lib/authorization';

export async function GET(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ username: session.username, role: session.role, customer: session.customer ?? null }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
