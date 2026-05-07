/**
 * Import station configs from CSV → MongoDB Station database.
 *
 * CSV columns:
 *   Displayname, station_name, topic_heartbeat, topic_heartbeatPI5,
 *   topic_meter, topic_PowerModule, topic_Router, Number of Charger heads,
 *   topic_PLCData, topic_fanRPM, collection_PowerModule, collection_Meter,
 *   collection_Router, collection_StatePLC, collection_HeartbeatFallingEdge,
 *   expectedPmHead1, expectedPmHead2
 *
 * Note: column order doesn't matter — parser uses header names.
 *
 * Usage:
 *   npm run import:stations -- path/to/stations.csv
 *   npm run import:stations -- stations.csv --dry-run   (preview without writing)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { MongoClient } from 'mongodb';

config({ path: resolve(__dirname, '..', '.env.local') });

const MONGO_URI  = process.env.MONGO_URI;
if (!MONGO_URI) { console.error('Missing MONGO_URI in .env.local'); process.exit(1); }
const STATION_DB = 'Station';

interface CsvRow {
  Displayname: string;
  station_name: string;
  topic_heartbeat: string;
  topic_heartbeatPI5: string;
  topic_meter: string;
  topic_PowerModule: string;
  topic_Router: string;
  'Number of Charger heads': string;
  topic_PLCData: string;
  topic_fanRPM: string;
  collection_PowerModule: string;
  collection_Meter: string;
  collection_Router: string;
  collection_StatePLC: string;
  collection_HeartbeatFallingEdge: string;
  expectedPmHead1: string;
  expectedPmHead2: string;
}

/** Minimal CSV parser — handles quoted fields, commas, and tabs as delimiter */
function parseCsv(text: string): CsvRow[] {
  // Strip BOM
  text = text.replace(/^﻿/, '');

  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];

  // Auto-detect delimiter (tab or comma — whichever is more frequent in header)
  const headerLine = lines[0];
  const tabCount   = (headerLine.match(/\t/g) || []).length;
  const commaCount = (headerLine.match(/,/g) || []).length;
  const delim = tabCount > commaCount ? '\t' : ',';

  const splitLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (c === delim && !inQuotes) {
        out.push(cur); cur = '';
      } else {
        cur += c;
      }
    }
    out.push(cur);
    return out.map(s => s.trim());
  };

  const headers = splitLine(headerLine);
  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i]);
    const row: any = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = cells[j] ?? '';
    }
    rows.push(row as CsvRow);
  }
  return rows;
}

function rowToStationDoc(r: CsvRow) {
  const name = r.station_name.trim();
  const id   = name.toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9_-]/g, '');
  const heads = Number(r['Number of Charger heads']) || 2;
  const exp1  = Number(r.expectedPmHead1) || 3;
  const exp2  = Number(r.expectedPmHead2) || 3;

  return {
    id,
    name,
    displayName: r.Displayname.trim() || name,
    location: '',
    chargerHeads: heads,
    expectedPmPerHead: exp1,           // legacy field — use head1 value
    expectedPmHead1:   exp1,
    expectedPmHead2:   exp2,
    fanBrand: 'EBM',
    mqttTopics: {
      heartbeat:    r.topic_heartbeat.trim(),
      heartbeatPi5: r.topic_heartbeatPI5.trim(),
      router:       r.topic_Router.trim(),
      meter:        r.topic_meter.trim(),
      powerModule:  r.topic_PowerModule.trim(),
      faultStatus:  '',
      statePlc:     '',
      fanRPM:       (r.topic_fanRPM || '').trim(),
      plc:          r.topic_PLCData.trim(),
    },
    mongoCollections: {
      powerModule:          r.collection_PowerModule.trim(),
      meter:                r.collection_Meter.trim(),
      heartbeatFallingEdge: r.collection_HeartbeatFallingEdge.trim(),
      router:               r.collection_Router.trim(),
      statePlc:             r.collection_StatePLC.trim(),
    },
    telegram: { chatId: '', botToken: '', enabled: false },
    createdAt: new Date().toISOString(),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const csvPath = args.find(a => !a.startsWith('--'));
  const dryRun  = args.includes('--dry-run');

  if (!csvPath) {
    console.error('Usage: npm run import:stations -- <csv-file> [--dry-run]');
    process.exit(1);
  }

  const text = readFileSync(resolve(csvPath), 'utf8');
  const rows = parseCsv(text);
  console.log(`Parsed ${rows.length} rows from ${csvPath}`);

  if (rows.length === 0) {
    console.error('No rows found. Check CSV format.');
    process.exit(1);
  }

  const docs = rows.map(rowToStationDoc);

  // Preview first 3
  console.log('\nPreview (first 3 stations):');
  for (const d of docs.slice(0, 3)) {
    console.log(`  ${d.id} (${d.displayName})`);
    console.log(`    HB: ${d.mqttTopics.heartbeat}`);
    console.log(`    PLC: ${d.mqttTopics.plc}`);
    console.log(`    Mongo collection: ${d.name}`);
  }
  if (docs.length > 3) console.log(`  ... ${docs.length - 3} more`);

  if (dryRun) {
    console.log('\n[dry-run] No writes performed.');
    return;
  }

  const client = new MongoClient(MONGO_URI!);
  await client.connect();
  const db = client.db(STATION_DB);
  console.log(`\nConnected to MongoDB → ${STATION_DB}`);

  let added = 0, updated = 0, errors = 0;
  for (const doc of docs) {
    const collectionName = doc.name;  // collection name = station name
    if (!collectionName) {
      console.error(`  skip: empty station_name`);
      errors++;
      continue;
    }
    try {
      const result = await db.collection(collectionName).updateOne(
        { id: doc.id },
        { $set: { ...doc, updatedAt: new Date() } },
        { upsert: true },
      );
      if (result.upsertedCount > 0) added++;
      else updated++;
    } catch (err: any) {
      console.error(`  error ${doc.id}:`, err.message);
      errors++;
    }
  }

  await client.close();

  console.log(`\n✓ Done`);
  console.log(`  Added:   ${added}`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Errors:  ${errors}`);
  console.log(`  Total:   ${docs.length}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
