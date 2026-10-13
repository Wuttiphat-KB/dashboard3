// Read-only export for reviewing customer mapping. No database mutations.
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { MongoClient } from 'mongodb';

config({ path: resolve('.env.local'), quiet: true });

async function main() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is missing');
  const client = new MongoClient(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  try {
    const stations = await client.db('Station').collection('_stations').find({}, {
      projection: { _id: 0, id: 1, name: 1, displayName: 1, customer: 1 },
    }).toArray();
    writeFileSync(resolve('outputs/customer-mapping-20261012/stations-readonly.json'), JSON.stringify(stations, null, 2));
    console.log(JSON.stringify({ stationCount: stations.length, sample: stations.slice(0, 5) }));
  } finally {
    await client.close();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
