import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { getExpectedCredentials, signToken, SESSION_COOKIE } from '../lib/auth';
import { canViewStation } from '../lib/stationAccess';

type Doc = Record<string, unknown>;

function matches(doc: Doc, query: Doc): boolean {
  return Object.entries(query).every(([key, value]) => {
    if (key === '$or') return (value as Doc[]).some(part => matches(doc, part));
    const actual = key.split('.').reduce<unknown>((obj, part) => (obj as Doc | undefined)?.[part], doc);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.entries(value as Doc).every(([op, expected]) => {
        if (op === '$in') return (expected as unknown[]).includes(actual);
        if (op === '$gte') return String(actual) >= String(expected);
        if (op === '$lte') return String(actual) <= String(expected);
        if (op === '$exists') return (actual !== undefined) === expected;
        return false;
      });
    }
    return actual === value;
  });
}

test('PTG only receives PT stations across lists, details, alerts, energy and statistics', async () => {
  process.env.MONGO_URI = 'mongodb://localhost:27017/customer-scope-test';
  const stations = [
    { id: 'PT-1', name: 'PT-STATION', customer: { name: 'PT' }, mqttTopics: {} },
    { id: 'OTHER-1', name: 'OTHER-STATION', customer: { name: 'PTG' }, mqttTopics: {} },
    { id: 'UNASSIGNED', name: 'UNASSIGNED', mqttTopics: {} },
    { id: 'LOWERCASE', name: 'LOWERCASE', customer: { name: 'pt' }, mqttTopics: {} },
  ];
  const data = new Map<string, Doc[]>([
    ['Station._stations', stations],
    ['Station._alerts', [
      ...Array.from({ length: 205 }, (_, i) => ({ id: `other-${i}`, stationId: 'OTHER-1', acknowledged: false })),
      { id: 'pt-alert', stationId: 'PT-1', acknowledged: false },
    ]],
    ['Station._peak_hourly', [
      { stationId: 'PT-1', date: '2026-10-12', hourOfDay: 8, kwh: 10 },
      { stationId: 'OTHER-1', date: '2026-10-12', hourOfDay: 8, kwh: 999 },
    ]],
    ['Station._charge_daily', [
      { stationId: 'PT-1', date: '2026-10-12', head1: { sessions: 1, totalKwh: 5 } },
      { stationId: 'OTHER-1', date: '2026-10-12', head1: { sessions: 9, totalKwh: 99 } },
    ]],
  ]);
  const accesses: string[] = [];
  const globals = globalThis as typeof globalThis & { __mongoClient?: unknown };
  const previousClient = globals.__mongoClient;
  globals.__mongoClient = {
    db: (dbName: string) => ({
      collection: (name: string) => {
        accesses.push(`${dbName}.${name}`);
        const docs = data.get(`${dbName}.${name}`) ?? [];
        return {
          findOne: async (query: Doc = {}) => docs.find(doc => matches(doc, query)) ?? null,
          find: (query: Doc = {}) => {
            let rows = docs.filter(doc => matches(doc, query));
            const cursor = {
              sort: () => cursor,
              limit: (count: number) => { rows = rows.slice(0, count); return cursor; },
              toArray: async () => structuredClone(rows),
            };
            return cursor;
          },
          listCollections: () => ({ toArray: async () => [] }),
        };
      },
      listCollections: () => ({ toArray: async () => [] }),
    }),
  };
  try {
    const { GET: list } = await import('../app/api/stations/route');
    const { GET: fleet } = await import('../app/api/fleet/route');
    const { GET: dashboard } = await import('../app/api/dashboard/[id]/route');
    const { GET: alerts } = await import('../app/api/alerts/route');
    const { GET: energy } = await import('../app/api/energy/route');
    const { GET: peakHours } = await import('../app/api/statistics/peak-hours/route');
    const { invalidateStationsCache } = await import('../lib/stationsCache');
    const { invalidateFleetCache } = await import('../lib/fleetCache');
    invalidateStationsCache();
    invalidateFleetCache();
    const viewerToken = await signToken('PTG');
    const adminToken = await signToken(getExpectedCredentials().username);
    const req = (path: string, token = viewerToken) => new NextRequest(`http://localhost${path}`, {
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
    });
    // Populate shared caches as admin, then ensure PTG cannot reuse unrestricted results.
    assert.equal((await (await list(req('/api/stations', adminToken))).json()).length, 4);
    assert.deepEqual((await (await list(req('/api/stations'))).json()).map((st: Doc) => st.id), ['PT-1']);
    assert.equal((await (await fleet(req('/api/fleet', adminToken))).json()).length, 4);
    assert.deepEqual((await (await fleet(req('/api/fleet'))).json()).map((row: { station: Doc }) => row.station.id), ['PT-1']);
    assert.equal((await (await list(req('/api/stations', adminToken))).json()).length, 4);

    for (const id of ['OTHER-1', 'OTHER-STATION', 'UNASSIGNED', 'LOWERCASE']) {
      accesses.length = 0;
      assert.equal((await dashboard(req(`/api/dashboard/${id}`), { params: Promise.resolve({ id }) })).status, 404);
      assert.ok(accesses.every(name => name.startsWith('Station.')), 'denied stations must not load telemetry');
    }
    const detail = await dashboard(req('/api/dashboard/PT-STATION'), { params: Promise.resolve({ id: 'PT-STATION' }) });
    assert.equal(detail.status, 200);
    const detailData = await detail.json();
    assert.equal(detailData.station.id, 'PT-1');
    assert.deepEqual(detailData.alerts.map((alert: Doc) => alert.id), ['pt-alert']);
    assert.deepEqual((await (await alerts(req('/api/alerts?unack=1'))).json()).map((alert: Doc) => alert.id), ['pt-alert']);
    const dates = 'start=2026-10-12&end=2026-10-12';
    assert.equal((await energy(req(`/api/energy?stationId=OTHER-1&${dates}`))).status, 404);
    assert.equal((await (await energy(req(`/api/energy?stationId=PT-1&${dates}`))).json())[0].head1.totalKwh, 5);
    const stats = await (await peakHours(req('/api/statistics/peak-hours?from=2026-10-12&to=2026-10-12'))).json();
    assert.equal(stats.totals.totalKwh, 10);
    assert.equal(stats.totals.stationCount, 1);

    // Customer reassignment and no matching stations must fail closed, including aggregates.
    stations[0].customer = { name: 'OTHER' };
    invalidateStationsCache();
    invalidateFleetCache();
    assert.deepEqual(await (await list(req('/api/stations'))).json(), []);
    assert.deepEqual(await (await fleet(req('/api/fleet'))).json(), []);
    assert.deepEqual(await (await alerts(req('/api/alerts'))).json(), []);
    assert.equal((await (await peakHours(req('/api/statistics/peak-hours?from=2026-10-12&to=2026-10-12'))).json()).totals.totalKwh, 0);
    assert.equal((await energy(req(`/api/energy?stationId=PT-1&${dates}`))).status, 404);
    assert.equal((await list(new NextRequest('http://localhost/api/stations'))).status, 401);
    assert.equal(canViewStation({ username: 'PTG', role: 'viewer', expiresAt: Infinity }, { customer: { name: 'PTG' } }), false);
  } finally {
    globals.__mongoClient = previousClient;
  }
});
