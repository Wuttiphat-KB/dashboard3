/**
 * Customer list — MongoDB `Station._customers` (server-side only).
 *
 *   { name, createdAt, createdBy }
 *
 * Admins register customer names on the Users & Roles page; Station Config and
 * the user editor offer them as suggestions. A station's customer is still the
 * plain text in station.customer.name, so removing a name from this list does
 * not change any station or user.
 */

import { getMongoClient } from './mongoClient';

const STATION_DB = 'Station';
const COLLECTION = '_customers';
export const MAX_CUSTOMER_NAME = 200;

export interface CustomerRecord { name: string; createdAt?: Date; createdBy?: string }

export class CustomerError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

async function col() {
  const client = await getMongoClient();
  const c = client.db(STATION_DB).collection(COLLECTION);
  const g = globalThis as any;
  if (!g.__customersIndexed) {
    g.__customersIndexed = true;
    Promise.resolve().then(() => c.createIndex({ name: 1 }, { unique: true })).catch(() => { g.__customersIndexed = false; });
  }
  return c;
}

export function normaliseCustomerName(v: unknown): string {
  return String(v ?? '').trim();
}

export async function listCustomers(): Promise<CustomerRecord[]> {
  const c = await col();
  return (await c.find({}, { projection: { _id: 0 } }).sort({ name: 1 }).toArray()) as any;
}

export async function createCustomer(nameRaw: unknown, createdBy: string): Promise<CustomerRecord> {
  const name = normaliseCustomerName(nameRaw);
  if (!name) throw new CustomerError('Customer name is required');
  if (name.length > MAX_CUSTOMER_NAME) throw new CustomerError(`Customer name must be ${MAX_CUSTOMER_NAME} characters or fewer`);
  const c = await col();
  if (await c.findOne({ name })) throw new CustomerError(`Customer "${name}" already exists`, 409);
  const doc = { name, createdAt: new Date(), createdBy };
  try {
    await c.insertOne({ ...doc });
  } catch (err: any) {
    if (err?.code === 11000) throw new CustomerError(`Customer "${name}" already exists`, 409);
    throw err;
  }
  return doc;
}

export async function deleteCustomer(nameRaw: unknown): Promise<void> {
  const name = normaliseCustomerName(nameRaw);
  const c = await col();
  const r = await c.deleteOne({ name });
  if (!r.deletedCount) throw new CustomerError('Customer not found', 404);
}
