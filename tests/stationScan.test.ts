import assert from 'node:assert/strict';
import test from 'node:test';
import type { Db } from 'mongodb';
import { configFilter, pruneStaleStations, scanStationCollections } from '../lib/stationScan';

type Doc = Record<string, unknown>;
type Cond = { $exists?: boolean; $nin?: unknown[]; $lt?: Date };

/** The few filter operators the code under test uses, evaluated on plain objects. */
function matches(d: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, raw]) => {
    const cond = raw as Cond;
    if (cond.$exists !== undefined) return (key in d) === cond.$exists;
    if (cond.$nin) return !cond.$nin.includes(d[key]);
    if (cond.$lt) {
      const v = d[key];
      return v instanceof Date && v < cond.$lt;
    }
    return false;
  });
}

interface Fake {
  db: Db;
  findOneOptions: Doc[];
  mirror: Doc[];
}

/**
 * Stand-in for the part of `Db` the scan touches. A collection given as an Error fails
 * every read, like a Mongo that times out under load.
 */
function fakeDb(collections: Record<string, Doc[] | Error>, mirror: Doc[] = []): Fake {
  const findOneOptions: Doc[] = [];
  const db = {
    listCollections: () => ({ toArray: async () => Object.keys(collections).map(name => ({ name })) }),
    collection: (name: string) => {
      if (name === '_stations') {
        return {
          find: (filter: Doc) => ({ toArray: async () => mirror.filter(d => matches(d, filter)).map(d => ({ id: d.id })) }),
          deleteMany: async (filter: Doc) => {
            for (let i = mirror.length - 1; i >= 0; i--) if (matches(mirror[i], filter)) mirror.splice(i, 1);
          },
        };
      }
      return {
        findOne: async (filter: Doc, options: Doc) => {
          findOneOptions.push(options);
          const docs = collections[name];
          if (docs instanceof Error) throw docs;
          return docs.find(d => matches(d, filter)) ?? null;
        },
      };
    },
  } as unknown as Db;
  return { db, findOneOptions, mirror };
}

const edge = (stationId: string): Doc => ({ stationId, device: 'Router', edge: 'falling', timestamp: new Date(), payload: {} });
const config = (id: string, name: string, extra: Doc = {}): Doc => ({ id, name, mqttTopics: { heartbeat: `${id}/hb` }, ...extra });

test('finds the config doc even when edge events sit in front of it', () => {
  // The recurring "station vanishes after a restart" case: the collection was deleted and
  // re-added, the old events stayed, and the new config doc went in behind them.
  const { db } = fakeDb({
    SKY_Rattanathibet1_1: [edge('SKYRATTANATHIBET11'), edge('SKYRATTANATHIBET11'), config('SKYRATTANATHIBET11', 'SKY_Rattanathibet1_1')],
    SKY_Rattanathibet1_2: [config('SKYRATTANATHIBET12', 'SKY_Rattanathibet1_2')],
  });
  return scanStationCollections(db, { requireTopics: true }).then(res => {
    assert.deepEqual(res.stations.map(s => s.id).sort(), ['SKYRATTANATHIBET11', 'SKYRATTANATHIBET12']);
    assert.equal(res.complete, true);
    assert.equal(res.scanned, 2);
  });
});

test('a collection with only events yields no station and is not a failure', async () => {
  const { db } = fakeDb({
    '26003': [edge('X'), edge('X')],
    EMPTY: [],
    REAL: [config('REAL', 'REAL')],
  });
  const res = await scanStationCollections(db, { requireTopics: true });
  assert.deepEqual(res.stations.map(s => s.id), ['REAL']);
  assert.equal(res.complete, true);
  assert.deepEqual(res.failed, []);
});

test('an unreadable collection is reported and makes the scan incomplete, the rest still load', async () => {
  const { db } = fakeDb({
    GOOD: [config('GOOD', 'GOOD')],
    SLOW: new Error('operation exceeded time limit'),
    ALSO_GOOD: [config('ALSO_GOOD', 'ALSO_GOOD')],
  });
  const res = await scanStationCollections(db, { requireTopics: true, concurrency: 2 });
  assert.deepEqual(res.stations.map(s => s.id).sort(), ['ALSO_GOOD', 'GOOD']);
  assert.equal(res.complete, false);
  assert.deepEqual(res.failed, ['SLOW']);
});

test('system.* and _* collections are never scanned', async () => {
  const { db, findOneOptions } = fakeDb({
    'system.views': [config('SYS', 'system.views')],
    _stations: [config('MIRROR', '_stations')],
    _alerts: [config('ALERT', '_alerts')],
    REAL: [config('REAL', 'REAL')],
  });
  const res = await scanStationCollections(db);
  assert.deepEqual(res.stations.map(s => s.id), ['REAL']);
  assert.equal(res.scanned, 1);
  assert.equal(findOneOptions.length, 1);
});

test('requireTopics: the backend skips a doc without mqttTopics, the web API keeps it', async () => {
  const noTopics = { id: 'NOTOPICS', name: 'NOTOPICS' };
  const backend = await scanStationCollections(fakeDb({ NOTOPICS: [noTopics] }).db, { requireTopics: true });
  assert.deepEqual(backend.stations, []);
  assert.equal(backend.complete, true);
  const web = await scanStationCollections(fakeDb({ NOTOPICS: [noTopics] }).db);
  assert.deepEqual(web.stations.map(s => s.id), ['NOTOPICS']);
});

test('same id in two collections: the canonical one wins, otherwise the newest', async () => {
  const older = new Date('2026-11-01T00:00:00Z');
  const newer = new Date('2026-11-10T00:00:00Z');

  // Renamed station: the orphan in the old collection is newer, but the canonical doc wins.
  const renamed = await scanStationCollections(fakeDb({
    OLD_NAME: [config('S1', 'NEW_NAME', { updatedAt: newer })],
    NEW_NAME: [config('S1', 'NEW_NAME', { updatedAt: older })],
  }).db);
  assert.equal(renamed.stations.length, 1);
  assert.deepEqual(renamed.stations[0].updatedAt, older);

  // Neither canonical: the most recently updated one wins.
  const neither = await scanStationCollections(fakeDb({
    A: [config('S2', 'X', { updatedAt: older })],
    B: [config('S2', 'X', { updatedAt: newer })],
  }).db);
  assert.deepEqual(neither.stations[0].updatedAt, newer);
});

test('every read has a time limit', async () => {
  const { db, findOneOptions } = fakeDb({ A: [config('A', 'A')], B: [config('B', 'B')] });
  await scanStationCollections(db, { maxTimeMS: 1234 });
  assert.deepEqual(findOneOptions.map(o => o.maxTimeMS), [1234, 1234]);
});

test('configFilter only matches config docs', () => {
  assert.equal(matches(edge('X'), configFilter()), false);
  assert.equal(matches(config('A', 'A'), configFilter()), true);
  assert.equal(matches({ id: 'A' }, configFilter(true)), false);
  assert.equal(matches(config('A', 'A'), configFilter(true)), true);
});

test('prune removes only old rows that are missing from the list', async () => {
  const snapshotAt = new Date('2026-11-20T04:00:00Z');
  const before = new Date('2026-11-20T03:00:00Z');
  const after = new Date('2026-11-20T04:00:05Z');
  const { db, mirror } = fakeDb({}, [
    { id: 'KEEP', syncedAt: before },        // in the list
    { id: 'GONE', syncedAt: before },        // not in the list, older than the snapshot → removed
    { id: 'JUST_SAVED', syncedAt: after },   // saved from /config while the sync ran → spared
    { id: 'NO_STAMP' },                      // no syncedAt → left alone
  ]);

  const removed = await pruneStaleStations(db, ['KEEP'], snapshotAt);

  assert.deepEqual(removed, ['GONE']);
  assert.deepEqual(mirror.map(d => d.id), ['KEEP', 'JUST_SAVED', 'NO_STAMP']);
});

test('prune with nothing stale deletes nothing', async () => {
  const { db, mirror } = fakeDb({}, [{ id: 'A', syncedAt: new Date('2026-11-20T03:00:00Z') }]);
  assert.deepEqual(await pruneStaleStations(db, ['A'], new Date('2026-11-20T04:00:00Z')), []);
  assert.equal(mirror.length, 1);
});
