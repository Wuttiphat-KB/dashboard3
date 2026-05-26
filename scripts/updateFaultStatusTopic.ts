/**
 * Targeted updater — sets `mqttTopics.faultStatus` on existing stations from a
 * CSV. Matches each CSV row to an existing station by `station_name`
 * (case-insensitive). Does NOT touch any other fields, so it's safe to run
 * even after stations have been edited in the /config UI.
 *
 * CSV column expected:  station_name, topic_faultStatus
 * (other columns are ignored, so the file from importStations.ts works as-is)
 *
 * Usage:
 *   npm run update:fault-status -- path/to/stations.csv
 *   npm run update:fault-status -- stations.csv --dry-run
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { MongoClient } from 'mongodb';

config({ path: resolve(__dirname, '..', '.env.local') });

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) { console.error('Missing MONGO_URI in .env.local'); process.exit(1); }
const STATION_DB = 'Station';

interface Row {
  station_name: string;
  topic_faultStatus: string;
}

function parseCsv(text: string): Row[] {
  text = text.replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headerLine = lines[0];
  const tabCount = (headerLine.match(/\t/g) || []).length;
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
  const idxName = headers.findIndex(h => h.toLowerCase() === 'station_name');
  const idxTopic = headers.findIndex(h => h.toLowerCase() === 'topic_faultstatus');
  if (idxName < 0 || idxTopic < 0) {
    console.error(`CSV must contain columns: station_name, topic_faultStatus`);
    console.error(`Found headers: ${headers.join(', ')}`);
    process.exit(1);
  }

  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i]);
    rows.push({
      station_name:      (cells[idxName]  || '').trim(),
      topic_faultStatus: (cells[idxTopic] || '').trim(),
    });
  }
  return rows;
}

async function main() {
  const args = process.argv.slice(2);
  const csvPath = args.find(a => !a.startsWith('--'));
  const dryRun = args.includes('--dry-run');

  if (!csvPath) {
    console.error('Usage: npm run update:fault-status -- <csv-file> [--dry-run]');
    process.exit(1);
  }

  const text = readFileSync(resolve(csvPath), 'utf8');
  const rows = parseCsv(text).filter(r => r.station_name);
  console.log(`Parsed ${rows.length} rows from ${csvPath}`);
  if (rows.length === 0) process.exit(1);

  const withTopic = rows.filter(r => r.topic_faultStatus);
  const blanks = rows.length - withTopic.length;
  console.log(`  Rows with topic_faultStatus: ${withTopic.length}`);
  if (blanks > 0) console.log(`  Rows with blank topic (will be cleared): ${blanks}`);

  // Preview first 5
  console.log('\nPreview (first 5):');
  for (const r of rows.slice(0, 5)) {
    console.log(`  ${r.station_name}  →  ${r.topic_faultStatus || '(blank)'}`);
  }

  if (dryRun) {
    console.log('\n[dry-run] No writes performed.');
    return;
  }

  const client = new MongoClient(MONGO_URI!);
  await client.connect();
  const db = client.db(STATION_DB);
  console.log(`\nConnected to MongoDB → ${STATION_DB}`);

  // Pull the full station list once from the mirror — fastest way to find
  // each row's matching station + collection name.
  const stations = await db.collection('_stations').find().toArray();
  console.log(`Loaded ${stations.length} stations from _stations`);

  // Index by lower-cased name AND id for forgiving lookup
  const byName = new Map<string, any>();
  for (const s of stations) {
    if (s.name) byName.set(String(s.name).toLowerCase(), s);
    if (s.id)   byName.set(String(s.id).toLowerCase(), s);
  }

  let matched = 0, updated = 0, notFound = 0, errors = 0;
  for (const row of rows) {
    const key = row.station_name.toLowerCase();
    const st = byName.get(key);
    if (!st) {
      notFound++;
      console.warn(`  ✗ not found: ${row.station_name}`);
      continue;
    }
    matched++;

    const newTopic = row.topic_faultStatus;
    const existingTopic = st.mqttTopics?.faultStatus || '';
    if (existingTopic === newTopic) {
      // No change — skip silently
      continue;
    }

    try {
      // Update both the _stations mirror AND the per-station collection.
      // (Per-station collection name == station.name)
      const perStationCol = String(st.name || st.id);
      await Promise.all([
        db.collection('_stations').updateOne(
          { id: st.id },
          { $set: { 'mqttTopics.faultStatus': newTopic, updatedAt: new Date() } },
        ),
        db.collection(perStationCol).updateOne(
          { id: st.id },
          { $set: { 'mqttTopics.faultStatus': newTopic, updatedAt: new Date() } },
        ),
      ]);
      updated++;
      console.log(`  ✓ ${st.id} (${st.displayName || st.name})  ${existingTopic || '∅'}  →  ${newTopic || '∅'}`);
    } catch (err: any) {
      console.error(`  ✗ error ${st.id}:`, err.message);
      errors++;
    }
  }

  await client.close();

  console.log(`\n✓ Done`);
  console.log(`  Matched:    ${matched}/${rows.length}`);
  console.log(`  Updated:    ${updated}  (rows already matching were skipped)`);
  console.log(`  Not found:  ${notFound}`);
  console.log(`  Errors:     ${errors}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
