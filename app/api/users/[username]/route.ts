import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession } from '@/lib/authorization';
import { updateUser, deleteUser, normaliseUsername, UserError } from '@/lib/users';
import { audit } from '@/lib/audit';

type Ctx = { params: Promise<{ username: string }> };

/**
 * PATCH  /api/users/:username  { role?, customer?, displayName?, disabled?, password? }
 * DELETE /api/users/:username
 * Admin only. An admin cannot demote, disable or delete their own account
 * (the .env built-in admin always remains as a recovery account).
 */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const username = normaliseUsername(decodeURIComponent((await params).username));
  try {
    const body = await req.json().catch(() => ({}));
    const input: any = {};
    for (const k of ['role', 'customer', 'displayName', 'disabled', 'password']) {
      if (body[k] !== undefined && body[k] !== null && !(k === 'password' && body[k] === '')) input[k] = body[k];
    }
    if (username === normaliseUsername(session.username)) {
      if ((input.role && input.role !== 'admin') || input.disabled === true) {
        return NextResponse.json({ error: 'You cannot demote or disable your own account' }, { status: 400 });
      }
    }
    const { before, after } = await updateUser(username, input);
    const changed: Record<string, unknown> = {};
    for (const k of ['role', 'customer', 'displayName', 'disabled'] as const) {
      if ((before as any)[k] !== (after as any)[k]) changed[k] = { from: (before as any)[k], to: (after as any)[k] };
    }
    if (input.password !== undefined) changed.password = 'changed';
    void audit(session, 'user_update', { req, target: username, details: changed });
    return NextResponse.json({ ok: true, user: after });
  } catch (err: any) {
    if (err instanceof UserError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[api/users] update error:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const username = normaliseUsername(decodeURIComponent((await params).username));
  if (username === normaliseUsername(session.username)) {
    return NextResponse.json({ error: 'You cannot delete your own account' }, { status: 400 });
  }
  try {
    const before = await deleteUser(username);
    void audit(session, 'user_delete', { req, target: username, details: { role: before.role, customer: before.customer } });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    if (err instanceof UserError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[api/users] delete error:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
}
