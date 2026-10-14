import { NextRequest, NextResponse } from 'next/server';
import { getMongoClient } from '@/lib/mongoClient';
import { getRequestSession } from '@/lib/authorization';
import { loadStations } from '@/lib/stationRepository';
import { listUsers, createUser, UserError, MIN_PASSWORD_LENGTH } from '@/lib/users';
import { getExpectedCredentials } from '@/lib/auth';
import { listCustomers } from '@/lib/customers';
import { audit } from '@/lib/audit';

/**
 * GET  /api/users  → { users, builtInAdmin, customers, minPasswordLength }
 * POST /api/users  { username, password, role, customer?, displayName?, disabled? }
 * Admin only.
 */
export async function GET(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const [users, stations, registered] = await Promise.all([listUsers(), loadStations(await getMongoClient()), listCustomers()]);
    const counts = new Map<string, number>();
    for (const st of stations) {
      const name = st?.customer?.name?.trim();
      if (name) counts.set(name, (counts.get(name) || 0) + 1);
    }
    const reg = new Map(registered.map(c => [c.name, c]));
    const names = new Set([...counts.keys(), ...reg.keys()]);
    const customers = [...names].sort((a, b) => a.localeCompare(b)).map(name => ({
      name,
      stationCount: counts.get(name) || 0,
      userCount: users.filter(u => u.role === 'customer' && u.customer === name).length,
      registered: reg.has(name),
      createdAt: reg.get(name)?.createdAt,
      createdBy: reg.get(name)?.createdBy,
    }));
    return NextResponse.json({
      users, customers, minPasswordLength: MIN_PASSWORD_LENGTH,
      builtInAdmin: getExpectedCredentials().username,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err: any) {
    console.error('[api/users] error:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const body = await req.json().catch(() => ({}));
    const user = await createUser(body, session.username);
    void audit(session, 'user_create', {
      req, target: user.username,
      details: { role: user.role, customer: user.customer, disabled: !!user.disabled },
    });
    return NextResponse.json({ ok: true, user });
  } catch (err: any) {
    if (err instanceof UserError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[api/users] create error:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
}
