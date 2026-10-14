/**
 * Audit log — MongoDB `Station._audit_log` (server-side only).
 *
 *   { at, username, role, customer?, action, target?, details?, ip?, ok }
 *
 * Writing never throws: an audit failure must not break the action itself.
 * Entries expire after AUDIT_RETENTION_DAYS (default 365) via a TTL index.
 */

import type { NextRequest } from 'next/server';
import { getMongoClient } from './mongoClient';

const STATION_DB = 'Station';
const COLLECTION = '_audit_log';

export type AuditAction =
  | 'login' | 'login_failed' | 'logout'
  | 'user_create' | 'user_update' | 'user_delete'
  | 'customer_create' | 'customer_delete'
  | 'station_save' | 'station_delete'
  | 'alert_ack' | 'energy_export'
  | 'vsecc_log_view' | 'vsecc_log_download';

export interface AuditActor { username: string; role?: string; customer?: string }

async function col() {
  const client = await getMongoClient();
  const c = client.db(STATION_DB).collection(COLLECTION);
  const g = globalThis as any;
  if (!g.__auditIndexed) {
    g.__auditIndexed = true;
    const days = Math.max(1, Number(process.env.AUDIT_RETENTION_DAYS) || 365);
    Promise.resolve().then(() => Promise.all([
      c.createIndex({ at: 1 }, { expireAfterSeconds: days * 86_400 }),
      c.createIndex({ username: 1, at: -1 }),
      c.createIndex({ action: 1, at: -1 }),
    ])).catch(() => { g.__auditIndexed = false; });
  }
  return c;
}

export function clientIp(req?: NextRequest | Request | null): string | undefined {
  if (!req) return undefined;
  const h = req.headers;
  return (h.get('x-forwarded-for')?.split(',')[0] || h.get('x-real-ip') || '').trim() || undefined;
}

export async function audit(
  actor: AuditActor | null,
  action: AuditAction,
  opts: { req?: NextRequest | Request | null; target?: string; details?: Record<string, unknown>; ok?: boolean } = {},
): Promise<void> {
  try {
    await (await col()).insertOne({
      at: new Date(),
      username: actor?.username || '(anonymous)',
      role: actor?.role,
      ...(actor?.customer ? { customer: actor.customer } : {}),
      action,
      ...(opts.target ? { target: opts.target } : {}),
      ...(opts.details ? { details: opts.details } : {}),
      ip: clientIp(opts.req),
      ok: opts.ok ?? true,
    });
  } catch (err: any) {
    console.error('[audit] write failed:', err?.message || err);
  }
}

export async function queryAudit(q: {
  username?: string; action?: string; from?: Date; to?: Date; limit?: number; skip?: number;
}) {
  const filter: any = {};
  if (q.username) filter.username = q.username;
  if (q.action) filter.action = q.action;
  if (q.from || q.to) filter.at = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lt: q.to } : {}) };
  const c = await col();
  const limit = Math.min(Math.max(q.limit || 100, 1), 500);
  const [rows, total] = await Promise.all([
    c.find(filter, { projection: { _id: 0 } }).sort({ at: -1 }).skip(q.skip || 0).limit(limit).toArray(),
    c.countDocuments(filter),
  ]);
  return { rows, total };
}
