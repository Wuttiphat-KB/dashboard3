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
import { invalidateUserCache } from './users';
import { invalidateFleetCache } from './fleetCache';
import { invalidateStationsCache } from './stationsCache';
import { invalidateResponse } from './apiCache';

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

/**
 * Rename a customer everywhere: the customer list, every station whose
 * customer.name matches (mirror + per-station collection) and every Customer
 * user assigned to it. Works for names that exist only on stations, too.
 * Users whose customer changes are signed out within ~30 s and must log in again.
 */
export async function renameCustomer(oldRaw: unknown, newRaw: unknown, by: string): Promise<{ stations: number; users: number }> {
  const oldName = normaliseCustomerName(oldRaw);
  const newName = normaliseCustomerName(newRaw);
  if (!oldName) throw new CustomerError('Current customer name is required');
  if (!newName) throw new CustomerError('New customer name is required');
  if (newName.length > MAX_CUSTOMER_NAME) throw new CustomerError(`Customer name must be ${MAX_CUSTOMER_NAME} characters or fewer`);
  if (newName === oldName) return { stations: 0, users: 0 };

  const c = await col();
  if (await c.findOne({ name: newName })) throw new CustomerError(`Customer "${newName}" already exists`, 409);

  const client = await getMongoClient();
  const db = client.db(STATION_DB);

  // Stations: update the mirror and each canonical per-station collection.
  const stations = await db.collection('_stations')
    .find({ 'customer.name': oldName }, { projection: { _id: 0, id: 1, name: 1 } }).toArray();
  const stamp = new Date();
  await Promise.all(stations.map(st => Promise.all([
    db.collection('_stations').updateOne({ id: st.id }, { $set: { 'customer.name': newName, syncedAt: stamp } }),
    st.name && !String(st.name).startsWith('_')
      ? db.collection(String(st.name)).updateOne({ id: st.id }, { $set: { 'customer.name': newName, updatedAt: stamp } })
      : Promise.resolve(),
  ])));

  // Users assigned to the old name.
  const users = await db.collection('_users').updateMany(
    { role: 'customer', customer: oldName },
    { $set: { customer: newName, updatedAt: stamp } },
  );

  // Customer list: rename the entry, or register the new name if the old one was stations-only.
  const existing = await c.findOne({ name: oldName });
  if (existing) await c.updateOne({ name: oldName }, { $set: { name: newName, updatedAt: stamp, updatedBy: by } });
  else await c.insertOne({ name: newName, createdAt: stamp, createdBy: by });

  invalidateUserCache();
  invalidateFleetCache();
  invalidateStationsCache();
  invalidateResponse('fleet');
  return { stations: stations.length, users: users.modifiedCount };
}
