import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { signToken, SESSION_COOKIE, getExpectedCredentials } from '../lib/auth';
import { validateChargeBoxId, trimChargeBoxId, CHARGE_BOX_ID_MAX_LENGTH } from '../lib/chargeBoxId';

test('validateChargeBoxId accepts blank/valid IDs and rejects bad ones', () => {
  for (const ok of [undefined, '', '   ', 'EGAT-BKK-003', 'SKY_Rattanathibet1_1', 'TH*EGAT*E001', 'a:b.c/d', ' ABC123 ', 'x'.repeat(CHARGE_BOX_ID_MAX_LENGTH)]) {
    assert.equal(validateChargeBoxId(ok), null, `expected ${JSON.stringify(ok)} to be valid`);
  }
  for (const bad of [null, 123, true, [], {}, 'x'.repeat(CHARGE_BOX_ID_MAX_LENGTH + 1), 'has space', 'tab\tinside', 'ตู้ชาร์จ', 'EGAT-บางนา', 'new\nline']) {
    assert.notEqual(validateChargeBoxId(bad), null, `expected ${JSON.stringify(bad)} to be rejected`);
  }
  assert.equal(trimChargeBoxId('  EGAT-01 '), 'EGAT-01');
  assert.equal(trimChargeBoxId(undefined), '');
});

test('ChargeBox ID survives station add, reload, edit and clearing, and bad values are rejected', async () => {
  process.env.MONGO_URI = 'mongodb://localhost:27017/chargebox-test';
  process.env.CONFIG_PIN = '';
  type Doc = Record<string, unknown>;
  const collections = new Map<string, Doc[]>();
  const collection = (name: string) => {
    if (!collections.has(name)) collections.set(name, []);
    const docs = collections.get(name)!;
    return {
      findOne: async (query: Doc) => docs.find(doc => Object.entries(query).every(([key, value]) => doc[key] === value)) ?? null,
      find: () => {
        const cursor = { maxTimeMS: () => cursor, toArray: async () => docs.map(doc => structuredClone(doc)) };
        return cursor;
      },
      updateOne: async (query: Doc, update: { $set: Doc }) => {
        const existing = docs.find(doc => doc.id === query.id);
        if (existing) Object.assign(existing, structuredClone(update.$set));
        else docs.push(structuredClone(update.$set));
      },
    };
  };
  const globals = globalThis as typeof globalThis & { __mongoClient?: unknown };
  const previousClient = globals.__mongoClient;
  globals.__mongoClient = { db: () => ({ collection }) };

  try {
    const { POST } = await import('../app/api/stations/save/route');
    const { GET } = await import('../app/api/stations/route');
    const { invalidateStationsCache } = await import('../lib/stationsCache');
    invalidateStationsCache();
    const token = await signToken({ username: getExpectedCredentials().username, role: 'admin' as const });
    const read = () => GET(new NextRequest('http://localhost/api/stations', { headers: { Cookie: `${SESSION_COOKIE}=${token}` } }));
    const save = (doc: Doc) => POST(new NextRequest('http://localhost/api/stations/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `${SESSION_COOKIE}=${token}` }, body: JSON.stringify(doc),
    }));
    const stored = async () => (await (await read()).json())[0].chargeBoxId;

    const station = { id: 'TEST-CBID', name: 'TEST-CBID', chargeBoxId: '  EGAT-BKK-003 ' };
    const added = await save(station);
    assert.equal(added.status, 200);
    assert.equal((await added.json()).mode, 'add');
    assert.equal(collections.get(station.name)?.[0].chargeBoxId, 'EGAT-BKK-003');
    assert.equal(collections.get('_stations')?.[0].chargeBoxId, 'EGAT-BKK-003');
    assert.equal(await stored(), 'EGAT-BKK-003');

    assert.equal((await save({ ...station, chargeBoxId: 'EGAT-BKK-004' })).status, 200);
    assert.equal(await stored(), 'EGAT-BKK-004');

    // Clients that don't send the field (older pages) must not erase a saved ID.
    assert.equal((await save({ id: station.id, name: station.name })).status, 200);
    assert.equal(await stored(), 'EGAT-BKK-004');

    // Invalid values are refused and leave the saved ID untouched.
    for (const chargeBoxId of [null, 42, [], 'has space', 'ตู้ชาร์จ', 'x'.repeat(CHARGE_BOX_ID_MAX_LENGTH + 1)]) {
      assert.equal((await save({ ...station, chargeBoxId })).status, 400, `expected 400 for ${JSON.stringify(chargeBoxId)}`);
    }
    assert.equal(await stored(), 'EGAT-BKK-004');

    // Blank clears it.
    assert.equal((await save({ ...station, chargeBoxId: '' })).status, 200);
    assert.equal(await stored(), '');
  } finally {
    globals.__mongoClient = previousClient;
  }
});
