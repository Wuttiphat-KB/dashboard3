import assert from 'node:assert/strict';
import test from 'node:test';
import {
  describeWarranty, formatWarrantyDate, isWarrantyExpired, normalizeWarrantyYears, todayInBangkok,
  trimCommissioningDate, validateCommissioningDate, validateWarrantyYears, warrantyExpiry, warrantyStatus,
  WARRANTY_YEARS_MAX,
} from '../lib/warranty';

test('warrantyExpiry adds whole years / half years and clamps to the end of the month', () => {
  assert.equal(warrantyExpiry('2023-06-15', 3), '2026-06-15');
  assert.equal(warrantyExpiry('2024-03-20', 2), '2026-03-20');
  assert.equal(warrantyExpiry('2025-01-15', 1.5), '2026-07-15');
  assert.equal(warrantyExpiry('2025-08-31', 0.5), '2026-02-28');   // Feb has no 31st
  assert.equal(warrantyExpiry('2024-02-29', 1), '2025-02-28');     // leap day + 1 year
  assert.equal(warrantyExpiry('2024-02-29', 4), '2028-02-29');     // …but 4 years later it exists again
  assert.equal(warrantyExpiry('2025-12-31', 1), '2026-12-31');
  assert.equal(warrantyExpiry(' 2023-06-15 ', 3), '2026-06-15');   // padded input still works
});

test('warrantyExpiry is null unless both values are present and valid', () => {
  assert.equal(warrantyExpiry('', 3), null);
  assert.equal(warrantyExpiry(undefined, 3), null);
  assert.equal(warrantyExpiry('2023-06-15', null), null);
  assert.equal(warrantyExpiry('2023-06-15', undefined), null);
  assert.equal(warrantyExpiry('2023-06-15', 0), null);
  assert.equal(warrantyExpiry('2023-02-30', 3), null);
  assert.equal(warrantyExpiry('15/06/2023', 3), null);
});

test('a station is covered through the expiry day and expired from the next day', () => {
  const at = (today: string) => warrantyStatus('2023-06-15', 3, today);
  assert.deepEqual(at('2026-06-14'), { state: 'active', expiresOn: '2026-06-15', daysLeft: 1 });
  assert.deepEqual(at('2026-06-15'), { state: 'active', expiresOn: '2026-06-15', daysLeft: 0 });
  assert.deepEqual(at('2026-06-16'), { state: 'expired', expiresOn: '2026-06-15', daysLeft: -1 });

  // The figures used in the mock-up (today = 25 Nov 2026).
  assert.equal(warrantyStatus('2023-06-15', 3, '2026-11-25').daysLeft, -163);
  assert.equal(warrantyStatus('2022-11-01', 3, '2026-11-25').daysLeft, -389);
  assert.equal(warrantyStatus('2024-03-20', 2, '2026-11-25').daysLeft, -250);
  assert.equal(warrantyStatus('2025-09-10', 3, '2026-11-25').daysLeft, 655);
  assert.equal(warrantyStatus('2025-01-15', 2, '2026-11-25').daysLeft, 51);

  // Not set / only one of the two → unknown, never "expired".
  assert.deepEqual(warrantyStatus('', null, '2026-11-25'), { state: 'unknown', expiresOn: null, daysLeft: null });
  assert.equal(warrantyStatus('2023-06-15', null, '2026-11-25').state, 'unknown');
  assert.equal(warrantyStatus(undefined, 3, '2026-11-25').state, 'unknown');
  assert.equal(isWarrantyExpired('2023-06-15', 3, '2026-11-25'), true);
  assert.equal(isWarrantyExpired('2025-09-10', 3, '2026-11-25'), false);
  assert.equal(isWarrantyExpired('', null, '2026-11-25'), false);
});

test('days are counted on the Bangkok calendar', () => {
  // 17:30 UTC on 14 Jun is already 00:30 on 15 Jun in Bangkok (UTC+7).
  assert.equal(todayInBangkok(new Date('2026-06-14T17:30:00Z')), '2026-06-15');
  assert.equal(todayInBangkok(new Date('2026-06-14T16:59:00Z')), '2026-06-14');
  assert.equal(todayInBangkok(new Date('2026-11-25T03:00:00Z')), '2026-11-25');
});

test('validation accepts blank / good values and rejects bad ones', () => {
  for (const ok of [undefined, null, '', '   ', '2023-06-15', ' 2024-02-29 ', '2000-01-01', '2100-12-31']) {
    assert.equal(validateCommissioningDate(ok), null, `expected ${JSON.stringify(ok)} to be valid`);
  }
  for (const bad of [123, true, [], {}, '2023-02-30', '2023-13-01', '2023-6-5', '15/06/2023', 'วันนี้', '1999-12-31', '2101-01-01', '0023-06-15', '2023-02-29']) {
    assert.notEqual(validateCommissioningDate(bad), null, `expected ${JSON.stringify(bad)} to be rejected`);
  }
  for (const ok of [undefined, null, 0.5, 1, 1.5, 3, 5, WARRANTY_YEARS_MAX]) {
    assert.equal(validateWarrantyYears(ok), null, `expected ${JSON.stringify(ok)} to be valid`);
  }
  for (const bad of [0, -1, 0.25, 1.3, WARRANTY_YEARS_MAX + 0.5, NaN, Infinity, '3', '', true, [], {}]) {
    assert.notEqual(validateWarrantyYears(bad), null, `expected ${JSON.stringify(bad)} to be rejected`);
  }
  assert.equal(trimCommissioningDate(' 2023-06-15 '), '2023-06-15');
  assert.equal(trimCommissioningDate(undefined), '');
  assert.equal(normalizeWarrantyYears(3), 3);
  assert.equal(normalizeWarrantyYears(undefined), null);
  assert.equal(normalizeWarrantyYears(NaN), null);
});

test('display helpers', () => {
  assert.equal(formatWarrantyDate('2026-06-15'), '15 Jun 2026');
  assert.equal(formatWarrantyDate('2025-01-05'), '5 Jan 2025');
  assert.equal(formatWarrantyDate(''), '');
  assert.equal(describeWarranty(warrantyStatus('2023-06-15', 3, '2026-11-25')), 'เมื่อ 15 Jun 2026 · เกินมา 163 วัน');
  assert.equal(describeWarranty(warrantyStatus('2025-09-10', 3, '2026-11-25')), 'ถึง 10 Sep 2028 · เหลืออีก 655 วัน');
  assert.equal(describeWarranty(warrantyStatus('2023-06-15', 3, '2026-06-15')), 'ถึง 15 Jun 2026 · วันสุดท้ายของประกัน');
  assert.equal(describeWarranty(warrantyStatus('', null, '2026-11-25')), '');
});

test('commissioning date and warranty years survive station add, reload, edit and clearing, and bad values are rejected', async () => {
  process.env.MONGO_URI = 'mongodb://localhost:27017/warranty-test';
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
    const { NextRequest } = await import('next/server');
    const { signToken, SESSION_COOKIE, getExpectedCredentials } = await import('../lib/auth');
    const { POST } = await import('../app/api/stations/save/route');
    const { GET } = await import('../app/api/stations/route');
    const { invalidateStationsCache } = await import('../lib/stationsCache');
    invalidateStationsCache();
    const token = await signToken({ username: getExpectedCredentials().username, role: 'admin' as const });
    const read = () => GET(new NextRequest('http://localhost/api/stations', { headers: { Cookie: `${SESSION_COOKIE}=${token}` } }));
    const save = (doc: Doc) => POST(new NextRequest('http://localhost/api/stations/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `${SESSION_COOKIE}=${token}` }, body: JSON.stringify(doc),
    }));
    const stored = async () => {
      const [station] = await (await read()).json();
      return [station.commissioningDate, station.warrantyYears];
    };

    const station = { id: 'TEST-WARR', name: 'TEST-WARR', commissioningDate: ' 2023-06-15 ', warrantyYears: 3 };
    const added = await save(station);
    assert.equal(added.status, 200);
    assert.equal((await added.json()).mode, 'add');
    assert.deepEqual([collections.get(station.name)?.[0].commissioningDate, collections.get(station.name)?.[0].warrantyYears], ['2023-06-15', 3]);
    assert.deepEqual([collections.get('_stations')?.[0].commissioningDate, collections.get('_stations')?.[0].warrantyYears], ['2023-06-15', 3]);
    assert.deepEqual(await stored(), ['2023-06-15', 3]);

    // Edit.
    assert.equal((await save({ ...station, commissioningDate: '2024-01-31', warrantyYears: 1.5 })).status, 200);
    assert.deepEqual(await stored(), ['2024-01-31', 1.5]);

    // Clients that don't send the fields (older pages) must not erase them.
    assert.equal((await save({ id: station.id, name: station.name })).status, 200);
    assert.deepEqual(await stored(), ['2024-01-31', 1.5]);

    // Invalid values are refused and leave the saved values untouched.
    for (const bad of [
      { commissioningDate: '2023-02-30' }, { commissioningDate: '15/06/2023' }, { commissioningDate: 20230615 }, { commissioningDate: '1999-01-01' },
      { warrantyYears: 0 }, { warrantyYears: -1 }, { warrantyYears: 1.3 }, { warrantyYears: '3' }, { warrantyYears: WARRANTY_YEARS_MAX + 1 }, { warrantyYears: [] },
    ]) {
      assert.equal((await save({ ...station, ...bad })).status, 400, `expected 400 for ${JSON.stringify(bad)}`);
    }
    assert.deepEqual(await stored(), ['2024-01-31', 1.5]);

    // '' / null (what /config sends for blank inputs) clear them.
    assert.equal((await save({ ...station, commissioningDate: '', warrantyYears: null })).status, 200);
    assert.deepEqual(await stored(), ['', null]);
  } finally {
    globals.__mongoClient = previousClient;
  }
});
