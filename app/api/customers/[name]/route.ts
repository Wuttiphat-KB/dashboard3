import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession } from '@/lib/authorization';
import { deleteCustomer, CustomerError } from '@/lib/customers';
import { audit } from '@/lib/audit';

/**
 * DELETE /api/customers/:name — removes the name from the customer list only;
 * stations and users that use it are not changed. Admin only.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const raw = (await params).name;
  let name = raw;
  try { name = decodeURIComponent(raw); } catch { /* already decoded */ }
  try {
    await deleteCustomer(name);
    void audit(session, 'customer_delete', { req, target: name });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    if (err instanceof CustomerError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[api/customers] delete error:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
}
