/**
 * Dashboard user accounts — MongoDB `Station._users` (server-side only).
 *
 *   { username, passwordHash, role: 'admin'|'customer', customer?, displayName?,
 *     disabled, createdAt, updatedAt, createdBy, lastLoginAt }
 *
 * Passwords are hashed with scrypt (node:crypto). The .env AUTH_USERNAME
 * account is a built-in admin handled in lib/auth and is never stored here.
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { getMongoClient } from './mongoClient';
import { ACCOUNT_ROLES, checkEnvAdmin, isEnvAdmin, type AccountRole, type SessionIdentity } from './auth';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number) => Promise<Buffer>;

const STATION_DB = 'Station';
const COLLECTION = '_users';
const USER_CACHE_MS = 30_000;
export const MIN_PASSWORD_LENGTH = 8;
const USERNAME_RE = /^[A-Za-z0-9._@-]{3,64}$/;

export interface UserRecord {
  username: string;
  role: AccountRole;
  customer?: string;
  displayName?: string;
  disabled?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  createdBy?: string;
  lastLoginAt?: Date;
}

export class UserError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

async function col() {
  const client = await getMongoClient();
  const c = client.db(STATION_DB).collection(COLLECTION);
  const g = globalThis as any;
  if (!g.__usersIndexed) {
    g.__usersIndexed = true;
    Promise.resolve().then(() => c.createIndex({ username: 1 }, { unique: true })).catch(() => { g.__usersIndexed = false; });
  }
  return c;
}

export function normaliseUsername(u: unknown): string {
  return String(u ?? '').trim().toLowerCase();
}

// ── Password hashing ─────────────────────────────────────────────────────
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltHex, hashHex] = String(stored || '').split('$');
  if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// A fixed hash so unknown usernames cost the same time as wrong passwords.
let dummyHash: Promise<string> | null = null;

/** Returns the session identity on success, null on bad credentials / disabled user. */
export async function authenticate(usernameRaw: string, password: string): Promise<SessionIdentity | null> {
  const trimmed = String(usernameRaw || '').trim();
  if (checkEnvAdmin(trimmed, password)) return { username: trimmed, role: 'admin' };

  const username = normaliseUsername(trimmed);
  const c = await col();
  const doc: any = await c.findOne({ username });
  if (!doc) {
    dummyHash ??= hashPassword('dummy-password-for-timing');
    await verifyPassword(password, await dummyHash);
    return null;
  }
  if (doc.disabled || !(await verifyPassword(password, doc.passwordHash))) return null;
  if (!ACCOUNT_ROLES.includes(doc.role)) return null;
  if (doc.role === 'customer' && !String(doc.customer || '').trim()) return null;

  c.updateOne({ username }, { $set: { lastLoginAt: new Date() } }).catch(() => {});
  return { username, role: doc.role, ...(doc.role === 'customer' ? { customer: String(doc.customer).trim() } : {}) };
}

// ── Session re-validation (cached) ───────────────────────────────────────
const g = globalThis as any;
const cache: Map<string, { rec: UserRecord | null; at: number }> = g.__userRecordCache ??= new Map();

export function invalidateUserCache(username?: string) {
  if (username) cache.delete(normaliseUsername(username)); else cache.clear();
}

/** Current record for a username (without hash), cached briefly. null = deleted. */
export async function getUserRecord(usernameRaw: string): Promise<UserRecord | null> {
  const username = normaliseUsername(usernameRaw);
  const hit = cache.get(username);
  if (hit && Date.now() - hit.at < USER_CACHE_MS) return hit.rec;
  const doc: any = await (await col()).findOne({ username }, { projection: { passwordHash: 0, _id: 0 } });
  const rec = doc ? (doc as UserRecord) : null;
  cache.set(username, { rec, at: Date.now() });
  return rec;
}

/** Is a token's identity still valid against the user store? */
export async function sessionStillValid(s: { username: string; role: AccountRole; customer?: string }): Promise<boolean> {
  if (isEnvAdmin(s.username)) return s.role === 'admin';
  const rec = await getUserRecord(s.username);
  if (!rec || rec.disabled || rec.role !== s.role) return false;
  if (rec.role === 'customer' && String(rec.customer || '').trim() !== (s.customer || '')) return false;
  return true;
}

// ── CRUD (admin API) ─────────────────────────────────────────────────────
function validateFields(input: { role?: unknown; customer?: unknown; password?: unknown }, creating: boolean) {
  if (creating || input.role !== undefined) {
    if (!ACCOUNT_ROLES.includes(input.role as AccountRole)) throw new UserError(`role must be one of: ${ACCOUNT_ROLES.join(', ')}`);
  }
  if (input.role === 'customer' && !String(input.customer ?? '').trim()) {
    throw new UserError('customer is required for role "customer"');
  }
  if (creating || input.password !== undefined) {
    const pw = String(input.password ?? '');
    if (pw.length < MIN_PASSWORD_LENGTH) throw new UserError(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
}

export async function listUsers(): Promise<UserRecord[]> {
  return (await col()).find({}, { projection: { passwordHash: 0, _id: 0 } }).sort({ username: 1 }).toArray() as any;
}

export async function createUser(input: any, createdBy: string): Promise<UserRecord> {
  const username = normaliseUsername(input?.username);
  if (!USERNAME_RE.test(username)) throw new UserError('username must be 3–64 characters: letters, digits, . _ @ -');
  if (isEnvAdmin(username)) throw new UserError('This username is reserved for the built-in admin');
  validateFields(input, true);
  const now = new Date();
  const doc = {
    username,
    passwordHash: await hashPassword(String(input.password)),
    role: input.role as AccountRole,
    ...(input.role === 'customer' ? { customer: String(input.customer).trim() } : {}),
    displayName: String(input.displayName ?? '').trim().slice(0, 100) || undefined,
    disabled: !!input.disabled,
    createdAt: now, updatedAt: now, createdBy,
  };
  try {
    await (await col()).insertOne(doc);
  } catch (err: any) {
    if (err?.code === 11000) throw new UserError(`User "${username}" already exists`, 409);
    throw err;
  }
  invalidateUserCache(username);
  const { passwordHash: _omit, ...safe } = doc;
  return safe;
}

export async function updateUser(usernameRaw: string, input: any): Promise<{ before: UserRecord; after: UserRecord }> {
  const username = normaliseUsername(usernameRaw);
  const c = await col();
  const before: any = await c.findOne({ username }, { projection: { passwordHash: 0, _id: 0 } });
  if (!before) throw new UserError('User not found', 404);

  const role = input.role !== undefined ? input.role : before.role;
  const customer = input.customer !== undefined ? input.customer : before.customer;
  validateFields({ role, customer, password: input.password }, false);

  const $set: any = { updatedAt: new Date(), role };
  const $unset: any = {};
  if (role === 'customer') $set.customer = String(customer).trim(); else $unset.customer = '';
  if (input.displayName !== undefined) $set.displayName = String(input.displayName).trim().slice(0, 100);
  if (input.disabled !== undefined) $set.disabled = !!input.disabled;
  if (input.password !== undefined) $set.passwordHash = await hashPassword(String(input.password));

  await c.updateOne({ username }, { $set, ...(Object.keys($unset).length ? { $unset } : {}) });
  invalidateUserCache(username);
  const after: any = await c.findOne({ username }, { projection: { passwordHash: 0, _id: 0 } });
  return { before, after };
}

export async function deleteUser(usernameRaw: string): Promise<UserRecord> {
  const username = normaliseUsername(usernameRaw);
  const c = await col();
  const before: any = await c.findOne({ username }, { projection: { passwordHash: 0, _id: 0 } });
  if (!before) throw new UserError('User not found', 404);
  await c.deleteOne({ username });
  invalidateUserCache(username);
  return before;
}
