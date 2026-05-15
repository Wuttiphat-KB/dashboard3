/**
 * One-shot script: create all MongoDB indexes the dashboard relies on.
 *
 * Run: npm run create-indexes
 *
 * Safe to re-run — createIndex is idempotent (it skips if the index already exists).
 */

import 'dotenv/config';
import { MongoClient } from 'mongodb';

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('Missing MONGO_URI in .env.local');
  process.exit(1);
}

interface IndexSpec {
  db: string;
  collection: string;
  keys: Record<string, 1 | -1>;
  options?: { unique?: boolean; name?: string };
}

/** Fixed cache collections in Station DB — one row per station */
const STATION_DB_INDEXES: IndexSpec[] = [
  { db: 'Station', collection: '_stations',       keys: { id: 1 },                       options: { unique: true } },
  { db: 'Station', collection: '_pm_data',        keys: { stationId: 1 },                options: { unique: true } },
  { db: 'Station', collection: '_meter_latest',   keys: { stationId: 1 },                options: { unique: true } },
  { db: 'Station', collection: '_router_data',    keys: { stationId: 1 },                options: { unique: true } },
  { db: 'Station', collection: '_plc_data',       keys: { stationId: 1 },                options: { unique: true } },
  { db: 'Station', collection: '_fan_data',       keys: { stationId: 1 },                options: { unique: true } },
  { db: 'Station', collection: '_device_status',  keys: { stationId: 1, device: 1 } },
  { db: 'Station', collection: '_script_status',  keys: { stationId: 1, script: 1 } },
  { db: 'Station', collection: '_alerts',         keys: { stationId: 1, acknowledged: 1, timestamp: -1 } },
  { db: 'Station', collection: '_alerts',         keys: { timestamp: -1 } },
];

async function main() {
  console.log(`Connecting to ${MONGO_URI!.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@')} ...`);
  const client = new MongoClient(MONGO_URI!, { serverSelectionTimeoutMS: 10_000 });
  await client.connect();
  console.log('Connected.\n');

  let created = 0;
  let skipped = 0;

  // 1. Station DB — cache collections
  console.log('═ Station DB ═');
  for (const spec of STATION_DB_INDEXES) {
    const t = Date.now();
    try {
      const name = await client.db(spec.db).collection(spec.collection).createIndex(spec.keys, spec.options || {});
      const elapsed = Date.now() - t;
      console.log(`  ✓ ${spec.db}.${spec.collection} { ${Object.entries(spec.keys).map(([k, v]) => `${k}:${v}`).join(', ')} }  (${name}, ${elapsed}ms)`);
      created++;
    } catch (err: any) {
      console.error(`  ✗ ${spec.db}.${spec.collection}:`, err?.message || err);
      skipped++;
    }
  }

  // 2. Per-station data DBs — index ALL collections (so fallback findOne is fast)
  const DATA_DBS = ['PowerModule', 'meter', 'Router', 'Heartbeat', 'PlcDatabase'] as const;
  for (const dbName of DATA_DBS) {
    console.log(`\n═ ${dbName} DB ═`);
    const db = client.db(dbName);
    const cols = await db.listCollections().toArray();
    const targets = cols.filter(c => !c.name.startsWith('system.') && !c.name.startsWith('_'));
    console.log(`  Found ${targets.length} per-station collections`);

    // Process in parallel batches to speed this up on slow Mongo.
    const BATCH = 10;
    let i = 0;
    for (let off = 0; off < targets.length; off += BATCH) {
      const batch = targets.slice(off, off + BATCH);
      await Promise.all(batch.map(async (col) => {
        try {
          if (dbName === 'PowerModule') {
            // PM queries filter by payload.PM1 / payload.PM2 existence + sort by _id
            await db.collection(col.name).createIndex({ 'payload.PM1': 1, _id: -1 });
            await db.collection(col.name).createIndex({ 'payload.PM2': 1, _id: -1 });
          } else if (dbName === 'meter') {
            // Meter queries sort by _id and filter by receivedAt
            await db.collection(col.name).createIndex({ _id: -1 });
            await db.collection(col.name).createIndex({ receivedAt: -1 });
          } else {
            // Router / Heartbeat / Plc — sort by _id desc only
            await db.collection(col.name).createIndex({ _id: -1 });
          }
          created++;
          i++;
          if (i % 50 === 0) console.log(`  ... ${i}/${targets.length}`);
        } catch (err: any) {
          console.error(`  ✗ ${dbName}.${col.name}:`, err?.message || err);
          skipped++;
        }
      }));
    }
    console.log(`  ✓ ${dbName}: ${targets.length} collections indexed`);
  }

  await client.close();
  console.log(`\nDone. Created/verified: ${created}, errors: ${skipped}`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
