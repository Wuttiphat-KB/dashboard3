import { config } from 'dotenv';
import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { MongoClient } from 'mongodb';
import { buildCustomerMapping, type MappingStation } from './customerMapping';

config({ path: resolve('.env.local'), quiet: true });
const outputDir = resolve('outputs/customer-mapping-20261012');
const sourceRows = JSON.parse(readFileSync(resolve(outputDir, 'source.json'), 'utf8')) as Array<{ row: number; station: string; customer: string }>;

async function main() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is missing');
  const client = new MongoClient(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  try {
    const db = client.db('Station');
    const stations = await db.collection('_stations').find({}, {
      projection: { id: 1, name: 1, displayName: 1, customer: 1 },
    }).toArray();
    if (!stations.length) throw new Error('No station mirror records found; no changes made');
    const plan = buildCustomerMapping(sourceRows, stations as unknown as MappingStation[]);
    const { mapping, unmatchedSource } = plan;
    writeFileSync(resolve(outputDir, 'mapping-plan.json'), JSON.stringify(plan, null, 2));
    console.log(JSON.stringify({ ...plan, mapping: undefined }, null, 2));
    if (!process.argv.includes('--apply')) return;
    if (plan.conflicts.length || plan.ambiguousSource.length) throw new Error('Conflicting/ambiguous mappings require review; no changes made');
    const updates = mapping.filter(row => row.status === 'update');
    const prepared = [];
    // Validate every canonical record before changing any station.
    for (const row of updates) {
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(row.name)) throw new Error(`Unsafe station collection name: ${row.name}`);
      const canonical = await db.collection(row.name).findOne({ id: row.id }, { projection: { id: 1, customer: 1 } });
      if (!canonical) throw new Error(`Canonical record missing for ${row.id}; no changes made`);
      const customer = typeof canonical.customer === 'object' && canonical.customer !== null ? { ...canonical.customer, name: row.customer } : { name: row.customer };
      prepared.push({ row, customer, previous: canonical.customer });
    }
    // Customer fields only; credentials are never included in backups.
    writeFileSync(resolve(outputDir, 'customer-backup.json'), JSON.stringify({ mirror: stations.map(({ id, name, customer }) => ({ id, name, customer })), canonical: prepared.map(({ row, previous }) => ({ id: row.id, name: row.name, customer: previous })) }, null, 2), { flag: 'wx' });
    const appliedIds: string[] = [];
    for (const { row, customer } of prepared) {
      const now = new Date();
      await db.collection(row.name).updateOne({ id: row.id }, { $set: { customer, updatedAt: now } });
      await db.collection('_stations').updateOne({ id: row.id }, { $set: { customer, updatedAt: now, syncedAt: now } });
      appliedIds.push(row.id);
      writeFileSync(resolve(outputDir, 'applied-stations.json'), JSON.stringify(appliedIds, null, 2));
      if (appliedIds.length % 20 === 0) console.log(`Updated ${appliedIds.length}/${prepared.length} stations`);
    }
    const verified = await db.collection('_stations').find({}, { projection: { id: 1, name: 1, displayName: 1, customer: 1 } }).toArray();
    const expected = mapping.filter(row => row.status === 'update' || row.status === 'unchanged');
    for (const row of expected) {
      if (verified.find(station => station.id === row.id)?.customer?.name !== row.customer) throw new Error(`Verification failed: ${row.id}`);
      const canonical = await db.collection(row.name).findOne({ id: row.id }, { projection: { customer: 1 } });
      if (canonical?.customer?.name !== row.customer) throw new Error(`Canonical verification failed: ${row.id}`);
    }
    const missing = verified.filter(station => !String(station.customer?.name ?? '').trim()).map(({ id, name, displayName }) => ({ id, name, displayName }));
    const result = { appliedAt: new Date().toISOString(), updated: mapping.filter(row => row.status === 'update').length, alreadyMatched: mapping.filter(row => row.status === 'unchanged').length, stations: verified.length, withCustomer: verified.length - missing.length, missingCustomer: missing, unmatchedSource };
    writeFileSync(resolve(outputDir, 'result.json'), JSON.stringify(result, null, 2));
    console.log('VERIFIED RESULT');
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await client.close();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
