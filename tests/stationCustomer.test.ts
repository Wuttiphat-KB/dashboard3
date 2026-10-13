import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { signToken, SESSION_COOKIE, getExpectedCredentials } from '../lib/auth';

test('customer name survives station add, reload, edit and clearing', async () => {
  process.env.MONGO_URI = 'mongodb://localhost:27017/customer-test';
  process.env.CONFIG_PIN = '';
  type Doc = Record<string, unknown>;
  const collections = new Map<string, Doc[]>();
  const collection = (name: string) => {
    if (!collections.has(name)) collections.set(name, []);
    const docs = collections.get(name)!;
    return {
      findOne: async (query: Doc) => docs.find(doc => Object.entries(query).every(([key, value]) => doc[key] === value)) ?? null,
      find: () => ({ toArray: async () => docs.map(doc => structuredClone(doc)) }),
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
    const token = await signToken(getExpectedCredentials().username);
    const read = () => GET(new NextRequest('http://localhost/api/stations', { headers: { Cookie: `${SESSION_COOKIE}=${token}` } }));
    const save = (doc: Doc) => POST(new NextRequest('http://localhost/api/stations/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `${SESSION_COOKIE}=${token}` }, body: JSON.stringify(doc),
    }));
    const station = { id: 'TEST-CUSTOMER', name: 'TEST-CUSTOMER', customer: {
      name: ' ลูกค้าไทย ',
    } };
    const response = await save(station);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).mode, 'add');
    const expected = Object.fromEntries(Object.entries(station.customer).map(([key, value]) => [key, value.trim()]));
    assert.deepEqual(collections.get(station.name)?.[0].customer, expected);
    assert.deepEqual(collections.get('_stations')?.[0].customer, expected);
    assert.deepEqual((await (await read()).json())[0].customer, expected);

    const edited = { ...station, customer: { name: 'ลูกค้าใหม่' } };
    assert.equal((await save(edited)).status, 200);
    assert.equal((await (await read()).json())[0].customer.name, 'ลูกค้าใหม่');

    // Clients without the new optional field must not erase saved customer data.
    assert.equal((await save({ id: station.id, name: station.name })).status, 200);
    assert.equal((await (await read()).json())[0].customer.name, 'ลูกค้าใหม่');

    assert.equal((await save({ ...station, customer: {} })).status, 200);
    assert.deepEqual((await (await read()).json())[0].customer, {});

    for (const customer of [null, [], 'invalid', { name: 123 }, { name: 'x'.repeat(201) }]) {
      assert.equal((await save({ ...station, customer })).status, 400);
    }
    assert.deepEqual(collections.get(station.name)?.[0].customer, {});
  } finally {
    globals.__mongoClient = previousClient;
  }
});
