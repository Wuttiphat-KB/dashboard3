// Writes commissioningDate / warrantyYears (from the FLEXXFAST Running no. sheet) into the station config.
//
//   npx tsx scripts/applyWarrantyFromSheet.ts                  dry run — writes the plan, changes nothing
//   npx tsx scripts/applyWarrantyFromSheet.ts --apply          write it (fills blanks only)
//   npx tsx scripts/applyWarrantyFromSheet.ts --apply --only-high   skip the medium-confidence matches
//   npx tsx scripts/applyWarrantyFromSheet.ts --apply --overwrite   also replace values already on /config
//
// Same pattern as mapStationCustomers.ts: validate everything first, back up, update the canonical
// station doc and the `_stations` mirror, then read it back and verify.
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { MongoClient } from 'mongodb';
import { buildWarrantyPlan, type LiveStation, type WarrantySourceRow } from './warrantyMapping';

config({ path: resolve('.env.local'), quiet: true });
const outputDir = resolve('outputs/warranty-mapping-20261125');
const sourceRows = JSON.parse(readFileSync(resolve(outputDir, 'warranty-source.json'), 'utf8')) as WarrantySourceRow[];
const flag = (name: string) => process.argv.includes(name);

async function main() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is missing');
  const client = new MongoClient(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  try {
    const db = client.db('Station');
    const stations = await db.collection('_stations').find({}, {
      projection: { _id: 0, id: 1, name: 1, displayName: 1, commissioningDate: 1, warrantyYears: 1 },
    }).toArray() as unknown as LiveStation[];
    if (!stations.length) throw new Error('No station mirror records found; no changes made');

    const plan = buildWarrantyPlan(sourceRows, stations, { onlyHigh: flag('--only-high'), overwrite: flag('--overwrite') });
    writeFileSync(resolve(outputDir, 'warranty-plan.json'), JSON.stringify(plan, null, 2));
    console.log(JSON.stringify({ ...plan, items: undefined, blocking: plan.blocking.map(item => ({ sheetRow: item.sheetRow, stationId: item.stationId, status: item.status, error: item.error })) }, null, 2));
    const conflicts = plan.items.filter(item => item.status === 'conflict');
    if (conflicts.length) console.log(`\n${conflicts.length} station(s) already hold a different value and are left alone (use --overwrite to replace):`,
      conflicts.map(item => `${item.stationId} ${JSON.stringify(item.conflicts)}`).join('\n  '));
    if (!flag('--apply')) { console.log('\nDRY RUN — nothing was written. Re-run with --apply to write.'); return; }
    if (plan.blocking.length) throw new Error('Plan has stations missing from the database, invalid values or duplicates; no changes made');

    const updates = plan.items.filter(item => item.status === 'update');
    // Validate every canonical record before changing any station.
    const prepared = [];
    for (const item of updates) {
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(item.name)) throw new Error(`Unsafe station collection name: ${item.name}`);
      const canonical = await db.collection(item.name).findOne({ id: item.stationId }, { projection: { _id: 0, id: 1, commissioningDate: 1, warrantyYears: 1 } });
      if (!canonical) throw new Error(`Canonical record missing for ${item.stationId}; no changes made`);
      prepared.push({ item, previous: canonical });
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    // Only the two warranty fields are backed up; credentials are never read.
    writeFileSync(resolve(outputDir, `warranty-backup-${stamp}.json`), JSON.stringify({
      mirror: stations.filter(st => updates.some(item => item.stationId === st.id)).map(({ id, name, commissioningDate, warrantyYears }) => ({ id, name, commissioningDate, warrantyYears })),
      canonical: prepared.map(({ item, previous }) => ({ id: item.stationId, name: item.name, commissioningDate: previous.commissioningDate, warrantyYears: previous.warrantyYears })),
    }, null, 2), { flag: 'wx' });

    const appliedIds: string[] = [];
    for (const { item } of prepared) {
      const now = new Date();
      await db.collection(item.name).updateOne({ id: item.stationId }, { $set: { ...item.changes, updatedAt: now } });
      await db.collection('_stations').updateOne({ id: item.stationId }, { $set: { ...item.changes, updatedAt: now, syncedAt: now } });
      appliedIds.push(item.stationId);
      writeFileSync(resolve(outputDir, 'warranty-applied.json'), JSON.stringify(appliedIds, null, 2));
      if (appliedIds.length % 25 === 0) console.log(`Updated ${appliedIds.length}/${prepared.length} stations`);
    }

    // Read everything back from both places.
    const verified = await db.collection('_stations').find({}, { projection: { _id: 0, id: 1, commissioningDate: 1, warrantyYears: 1 } }).toArray();
    for (const { item } of prepared) {
      const mirror = verified.find(st => st.id === item.stationId);
      const canonical = await db.collection(item.name).findOne({ id: item.stationId }, { projection: { commissioningDate: 1, warrantyYears: 1 } });
      for (const [field, value] of Object.entries(item.changes)) {
        if (mirror?.[field] !== value) throw new Error(`Verification failed (mirror): ${item.stationId}.${field}`);
        if (canonical?.[field] !== value) throw new Error(`Verification failed (canonical): ${item.stationId}.${field}`);
      }
    }
    const result = {
      appliedAt: new Date().toISOString(), updated: updates.length, alreadyCorrect: plan.counts.unchanged, leftAloneConflicts: conflicts.length,
      stations: verified.length,
      withCommissioningDate: verified.filter(st => st.commissioningDate).length,
      withWarrantyYears: verified.filter(st => typeof st.warrantyYears === 'number').length,
    };
    writeFileSync(resolve(outputDir, 'warranty-result.json'), JSON.stringify(result, null, 2));
    console.log('VERIFIED RESULT');
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await client.close();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
