import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession } from '@/lib/authorization';
import { listCustomers, createCustomer, CustomerError } from '@/lib/customers';
import { audit } from '@/lib/audit';

/**
 * GET  /api/customers  → { customers: [{ name, createdAt, createdBy }] }
 * POST /api/customers  { name }
 * Admin only.
 */
export async function GET(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    return NextResponse.json({ customers: await listCustomers() }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err: any) {
    console.error('[api/customers] error:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const body = await req.json().catch(() => ({}));
    const customer = await createCustomer(body?.name, session.username);
    void audit(session, 'customer_create', { req, target: customer.name });
    return NextResponse.json({ ok: true, customer });
  } catch (err: any) {
    if (err instanceof CustomerError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[api/customers] create error:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
}
