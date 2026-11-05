import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { getExpectedCredentials, signToken, SESSION_COOKIE } from '../lib/auth';

type Doc = Record<string, unknown>;
// API rows are loosely typed JSON in these assertions.
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function matches(doc: Doc, query: Doc): boolean {
  return Object.entries(query).every(([key, value]) => {
    if (key === '$or') return (value as Doc[]).some(part => matches(doc, part));
    const actual = key.split('.').reduce<unknown>((obj, part) => (obj as Doc | undefined)?.[part], doc);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.entries(value as Doc).every(([op, expected]) => {
        if (op === '$exists') return (actual !== undefined) === expected;
        return false;
      });
    }
    return actual === value;
  });
}

const MIN = 60_000;

test('an offline station shows Offline heads and no live PM, device status or fan readings instead of its last cached payload', async () => {
  process.env.MONGO_URI = 'mongodb://localhost:27017/offline-station-test';
  const now = Date.now();
  const ago = (ms: number) => new Date(now - ms);
  const station = (id: string) => ({ id, name: id, displayName: id, chargerHeads: 2, mqttTopics: {}, mongoCollections: {} });
  const heartbeats = (stationId: string, lastSeen: Date) =>
    ['heartbeat', 'heartbeatPi5', 'router'].map(device => ({ stationId, device, online: true, lastSeen }));
  // What the cabinet in the bug report sent just before it dropped off the network.
  const lastPayload = {
    chargeState1: 'PreCharge', chargeState2: 'Charging', powerKw2: 90, SOC2: 55,
    HMI_status: 'Active', PLC1_status: 'Active', PLC2_status: 'Active',
    temp1Head1: 41, temp2Head1: 40, temp1Head2: 43, temp2Head2: 42,
    timestamp: '2026-11-05T13:00:00',
  };
  const offFanAt = ago(120 * MIN);
  const data = new Map<string, Doc[]>([
    ['Station._stations', [station('OFF'), station('OFF-NOPM'), station('LIVE'), station('STALE')]],
    ['Station._device_status', [
      ...heartbeats('OFF', ago(120 * MIN)),
      ...heartbeats('OFF-NOPM', ago(120 * MIN)),
      ...heartbeats('LIVE', ago(30_000)),
      ...heartbeats('STALE', ago(30_000)),
    ]],
    ['Station._plc_data', [
      { stationId: 'OFF',   payload: lastPayload, updatedAt: ago(120 * MIN) },
      { stationId: 'LIVE',  payload: { ...lastPayload, chargeState1: 'Charging', powerKw1: 60, SOC1: 30 }, updatedAt: ago(10_000) },
      // Station still answers heartbeats, but its PLC feed stopped 20 minutes ago.
      { stationId: 'STALE', payload: lastPayload, updatedAt: ago(20 * MIN) },
    ]],
    ['Station._pm_data', [
      { stationId: 'OFF',   head1: { pmCount: 3 }, head2: { pmCount: 2 } },
      { stationId: 'LIVE',  head1: { pmCount: 3 }, head2: { pmCount: 3 } },
      { stationId: 'STALE', head1: { pmCount: 3 }, head2: { pmCount: 3 } },
    ]],
    ['Station._fan_data', [
      { stationId: 'OFF',   fans: { 'FAN 1': 4507.99, 'FAN 2': 4498.2 }, updatedAt: offFanAt },
      { stationId: 'LIVE',  fans: { 'FAN 1': 5201.5, 'FAN 2': 0 }, updatedAt: ago(15_000) },
      { stationId: 'STALE', fans: { 'FAN 1': 3000 }, updatedAt: ago(20 * MIN) },
    ]],
    // History read by /api/fleet's fallback (OFF-NOPM has no _pm_data) and by /api/dashboard.
    ['PowerModule.OFF',      [{ payload: { PM1: 3, PM2: 2 } }]],
    ['PowerModule.OFF-NOPM', [{ payload: { PM1: 4, PM2: 4 } }]],
    ['PowerModule.LIVE',     [{ payload: { PM1: 3, PM2: 3 } }]],
    ['PowerModule.STALE',    [{ payload: { PM1: 3, PM2: 3 } }]],
  ]);
  const globals = globalThis as typeof globalThis & { __mongoClient?: unknown };
  const previousClient = globals.__mongoClient;
  globals.__mongoClient = {
    db: (dbName: string) => ({
      collection: (name: string) => {
        const docs = data.get(`${dbName}.${name}`) ?? [];
        return {
          findOne: async (query: Doc = {}) => structuredClone(docs.find(doc => matches(doc, query)) ?? null),
          find: (query: Doc = {}) => {
            let rows = docs.filter(doc => matches(doc, query));
            const cursor = {
              sort: () => cursor,
              maxTimeMS: () => cursor,
              limit: (count: number) => { rows = rows.slice(0, count); return cursor; },
              toArray: async () => structuredClone(rows),
            };
            return cursor;
          },
        };
      },
      listCollections: () => ({ toArray: async () => [] }),
    }),
  };
  try {
    const { GET: fleet } = await import('../app/api/fleet/route');
    const { GET: dashboard } = await import('../app/api/dashboard/[id]/route');
    const { invalidateFleetCache } = await import('../lib/fleetCache');
    invalidateFleetCache();
    const token = await signToken({ username: getExpectedCredentials().username, role: 'admin' as const });
    const req = (path: string) => new NextRequest(`http://localhost${path}`, {
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
    });

    // ── Overview cards (/api/fleet) ──
    const rows: Row[] = await (await fleet(req('/api/fleet'))).json();
    const row = (id: string) => rows.find(r => r.station.id === id)!;

    const off = row('OFF');
    assert.equal(off.status, 'offline');
    assert.deepEqual(off.plcHeads, [
      { head: 1, chargeState: 'Offline', powerKw: 0, soc: 0 },
      { head: 2, chargeState: 'Offline', powerKw: 0, soc: 0 },
    ]);
    // Last known module count is kept, but it no longer counts as active.
    assert.deepEqual(off.powerModule.map((h: Row) => [h.pmCount, h.online]), [[3, false], [2, false]]);
    assert.equal(off.deviceStatus, undefined);
    // No fan readings while offline; the time of the last snapshot is kept.
    assert.deepEqual(off.fan, { fans: {}, timestamp: offFanAt.toISOString(), live: false });

    // Heads filled from PowerModule history follow the same rule.
    const offNoPm = row('OFF-NOPM');
    assert.deepEqual(offNoPm.powerModule.map((h: Row) => [h.pmCount, h.online]), [[4, false], [4, false]]);
    assert.deepEqual(offNoPm.plcHeads.map((h: Row) => h.chargeState), ['Offline', 'Offline']);

    const live = row('LIVE');
    assert.equal(live.status, 'online');
    assert.deepEqual(live.plcHeads, [
      { head: 1, chargeState: 'Charging', powerKw: 60, soc: 30 },
      { head: 2, chargeState: 'Charging', powerKw: 90, soc: 55 },
    ]);
    assert.deepEqual(live.powerModule.map((h: Row) => h.online), [true, true]);
    assert.equal(live.deviceStatus.plc1, 'Active');
    assert.deepEqual([live.fan.fans, live.fan.live], [{ 'FAN 1': 5201.5, 'FAN 2': 0 }, true]);

    const stale = row('STALE');
    assert.equal(stale.status, 'online');
    assert.deepEqual(stale.plcHeads.map((h: Row) => h.chargeState), ['Unknown', 'Unknown']);
    assert.equal(stale.deviceStatus, undefined);
    assert.deepEqual(stale.powerModule.map((h: Row) => h.online), [true, true]);  // PM is not age-gated
    assert.deepEqual([stale.fan.fans, stale.fan.live], [{ 'FAN 1': 3000 }, true]);  // nor are fans

    // ── Station page (/api/dashboard/[id]) ──
    const detail = async (id: string): Promise<Row> =>
      (await dashboard(req(`/api/dashboard/${id}`), { params: Promise.resolve({ id }) })).json();

    const offDetail = await detail('OFF');
    assert.equal(offDetail.plcData.live, false);
    assert.equal(offDetail.plcData.head2.chargeState, 'Offline');
    assert.equal(offDetail.plcData.head2.powerKw, 0);
    assert.equal(offDetail.plcData.head2.soc, 0);
    assert.equal(offDetail.plcData.head1.temp1Head, 0);
    assert.equal(offDetail.plcData.timestamp, '2026-11-05T13:00:00');  // "Last PLC payload" still shown
    assert.deepEqual(offDetail.powerModuleHeads.map((h: Row) => [h.pmCount, h.online]), [[3, false], [2, false]]);
    assert.deepEqual(offDetail.fanData, { fans: {}, timestamp: offFanAt.toISOString(), live: false });

    const noPlcDetail = await detail('OFF-NOPM');
    assert.equal(noPlcDetail.plcData.live, false);
    assert.equal(noPlcDetail.plcData.head1.chargeState, 'Offline');
    assert.equal(noPlcDetail.plcData.timestamp, '');

    const liveDetail = await detail('LIVE');
    assert.equal(liveDetail.plcData.live, true);
    assert.equal(liveDetail.plcData.head2.chargeState, 'Charging');
    assert.equal(liveDetail.plcData.head2.powerKw, 90);
    assert.deepEqual(liveDetail.powerModuleHeads.map((h: Row) => h.online), [true, true]);
    assert.deepEqual([liveDetail.fanData.fans, liveDetail.fanData.live], [{ 'FAN 1': 5201.5, 'FAN 2': 0 }, true]);

    const staleDetail = await detail('STALE');
    assert.equal(staleDetail.plcData.live, false);
    assert.deepEqual([staleDetail.plcData.head1.chargeState, staleDetail.plcData.head2.chargeState], ['Unknown', 'Unknown']);
  } finally {
    globals.__mongoClient = previousClient;
  }
});
