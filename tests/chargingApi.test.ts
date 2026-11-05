import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { getExpectedCredentials, signToken, SESSION_COOKIE } from '../lib/auth';
import { classifyState, headFlags, headFromPlc, stationHas, stationKw, summarizeStations, type ChargingHead, type ChargingStation } from '../lib/charging';

type Doc = Record<string, unknown>;

function matches(doc: Doc, query: Doc): boolean {
  return Object.entries(query).every(([key, value]) => {
    if (key === '$or') return (value as Doc[]).some(part => matches(doc, part));
    const actual = key.split('.').reduce<unknown>((obj, part) => (obj as Doc | undefined)?.[part], doc);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.entries(value as Doc).every(([op, expected]) => {
        if (op === '$in') return (expected as unknown[]).includes(actual);
        if (op === '$exists') return (actual !== undefined) === expected;
        return false;
      });
    }
    return actual === value;
  });
}

// Excerpt of a real Phoenix PLC topic payload (2026-11-05) — values arrive as strings.
const PLC_SAMPLE: Doc = {
  chargeState1: 'Charging', SOC1: '33', powerKw1: '43', maxPower1: '60000',
  presentVoltage1: '335', presentCurrent1: '129', targetVoltage1: '360.6', targetCurrent1: '129',
  temp1Head1: '36', temp2Head1: '36', activeMld1: '2', finishing1: '0', head1Error: '0', errorMessage1: ' ',
  LX_EvStoppedCharging1: '0', LX_EvseStoppedCharging1: '0', insulationFault1: '0',
  chargeState2: 'Charging', SOC2: '34', powerKw2: '69', maxPower2: '131631',
  presentVoltage2: '351', presentCurrent2: '198', targetVoltage2: '382', targetCurrent2: '198',
  temp1Head2: '39', temp2Head2: '43', activeMld2: '3', finishing2: '0', head2Error: '0', errorMessage2: ' ',
  LX_EvStoppedCharging2: '0', LX_EvseStoppedCharging2: '0', insulationFault2: '0',
  resetPowerModule2: 'var not found', plcTemp1: null,
  timestamp: '2026-11-05T15:54:49.295735',
};

test('headFromPlc parses the string-valued PLC payload', () => {
  assert.deepEqual(headFromPlc(PLC_SAMPLE, 2, 'Unknown'), {
    head: 2, state: 'Charging', soc: 34, powerKw: 69, maxPowerKw: 131.631,
    voltage: 351, current: 198, targetVoltage: 382, targetCurrent: 198,
    cableTempC: 43, activeModules: 3,
    finishing: false, evStopped: false, evseStopped: false, insulationFault: false, error: '',
  });
  const fault = headFromPlc({ chargeState1: 'Fault', head1Error: '1', errorMessage1: ' E-Stop pressed ', SOC1: 'var not found' }, 1, 'Unknown');
  assert.equal(fault.error, 'E-Stop pressed');
  assert.equal(fault.soc, 0);
  assert.equal(headFromPlc(null, 1, 'Offline').state, 'Offline');
});

test('classifyState groups the open-ended PLC states', () => {
  assert.equal(classifyState('Charging'), 'charging');
  for (const s of ['PreCharge', 'Connected', 'Finishing', 'Preparing']) assert.equal(classifyState(s), 'session', s);
  for (const s of ['Ready', 'Available']) assert.equal(classifyState(s), 'ready', s);
  assert.equal(classifyState('Fault'), 'fault');
  assert.equal(classifyState('Offline'), 'offline');
  assert.equal(classifyState('Unknown'), 'unknown');
  assert.equal(classifyState(''), 'unknown');
});

test('headFlags does not repeat the state or the same fault twice', () => {
  const base = headFromPlc(PLC_SAMPLE, 1, 'Unknown');
  assert.deepEqual(headFlags(base), []);
  // Error text and insulation bit describing the same fault → one chip.
  assert.deepEqual(headFlags({ ...base, state: 'Fault', error: 'Insulation fault', insulationFault: true }),
    [{ label: 'Insulation fault', tone: 'error' }]);
  // State already says Finishing → no extra "Finishing" chip.
  assert.deepEqual(headFlags({ ...base, state: 'Finishing', finishing: true, evStopped: true }),
    [{ label: 'EV stopped', tone: 'info' }]);
});

test('summarizeStations counts cabinets, not heads; stationKw counts charging heads only', () => {
  const head = (state: string, powerKw: number, soc: number): ChargingHead => ({ ...headFromPlc(null, 1, state), state, powerKw, soc });
  const cabinet = (id: string, ...heads: ChargingHead[]) => ({
    station: { id, name: id, displayName: id, chargerHeads: heads.length },
    status: 'online', live: true, updatedAt: null, heads,
  }) as ChargingStation;
  const stations = [
    cabinet('A', head('Charging', 43, 33), head('Charging', 69, 34)),
    cabinet('B', head('Charging', 25, 88), head('Ready', 0, 0)),     // counts as charging AND available
    cabinet('C', head('Finishing', 4, 96), head('Ready', 0, 0)),
    cabinet('D', head('Fault', 0, 0), head('Ready', 0, 0)),
    cabinet('E', head('Offline', 0, 0), head('Offline', 0, 0)),
  ];
  assert.deepEqual(summarizeStations(stations), { stations: 5, charging: 2, available: 3, fault: 1, noData: 1 });
  assert.equal(stationKw(stations[0]), 112);
  assert.equal(stationKw(stations[2]), 0);  // Finishing isn't counted as delivering
  assert.equal(stationHas(stations[1], 'ready'), true);
  assert.equal(stationHas(stations[4], 'fault'), false);
  assert.deepEqual(summarizeStations([]), { stations: 0, charging: 0, available: 0, fault: 0, noData: 0 });
});

test('/api/charging: live heads from the PLC payload, Offline/Unknown when not live, customer scope', async () => {
  process.env.MONGO_URI = 'mongodb://localhost:27017/charging-test';
  const now = Date.now();
  const ago = (ms: number) => new Date(now - ms);
  const hb = (stationId: string, lastSeen: Date) =>
    ['heartbeat', 'heartbeatPi5', 'router'].map(device => ({ stationId, device, lastSeen }));
  const offlineSince = ago(3 * 3_600_000);
  const data = new Map<string, Doc[]>([
    ['Station._users', [{ username: 'pt.user', role: 'customer', customer: 'PT' }]],
    ['Station._stations', [
      { id: 'LIVE', name: 'LIVE', displayName: 'Live 1', chargerHeads: 2, customer: { name: 'PT' } },
      { id: 'OFF', name: 'OFF', chargerHeads: 2, customer: { name: 'PT' } },
      { id: 'STALE', name: 'STALE', chargerHeads: 2, customer: { name: 'OTHER' } },
      { id: 'SINGLE', name: 'SINGLE', chargerHeads: 1, hasPi5: false, customer: { name: 'OTHER' } },
    ]],
    ['Station._device_status', [
      ...hb('LIVE', ago(20_000)), ...hb('OFF', offlineSince), ...hb('STALE', ago(20_000)), ...hb('SINGLE', ago(20_000)),
    ]],
    ['Station._plc_data', [
      { stationId: 'LIVE', payload: PLC_SAMPLE, updatedAt: ago(5_000) },
      { stationId: 'OFF', payload: PLC_SAMPLE, updatedAt: offlineSince },
      { stationId: 'STALE', payload: PLC_SAMPLE, updatedAt: ago(30 * 60_000) },
      { stationId: 'SINGLE', payload: PLC_SAMPLE, updatedAt: ago(5_000) },
    ]],
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
            const rows = docs.filter(doc => matches(doc, query));
            const cursor = { sort: () => cursor, limit: () => cursor, maxTimeMS: () => cursor, toArray: async () => structuredClone(rows) };
            return cursor;
          },
        };
      },
      listCollections: () => ({ toArray: async () => [] }),
    }),
  };
  try {
    const { GET } = await import('../app/api/charging/route');
    const { invalidateStationsCache } = await import('../lib/stationsCache');
    invalidateStationsCache();
    const token = async (role: 'admin' | 'customer') => role === 'admin'
      ? signToken({ username: getExpectedCredentials().username, role: 'admin' as const })
      : signToken({ username: 'pt.user', role: 'customer' as const, customer: 'PT' });
    const get = async (role: 'admin' | 'customer') => {
      const res = await GET(new NextRequest('http://localhost/api/charging', {
        headers: { Cookie: `${SESSION_COOKIE}=${await token(role)}` },
      }));
      assert.equal(res.status, 200);
      return res.json();
    };

    const rows = await get('admin');
    const row = (id: string) => rows.find((r: { station: { id: string } }) => r.station.id === id);

    const live = row('LIVE');
    assert.equal(live.status, 'online');
    assert.equal(live.live, true);
    assert.equal(live.station.displayName, 'Live 1');
    assert.deepEqual(live.heads.map((h: Doc) => [h.state, h.soc, h.powerKw, h.maxPowerKw]), [
      ['Charging', 33, 43, 60],
      ['Charging', 34, 69, 131.631],
    ]);

    const off = row('OFF');
    assert.equal(off.status, 'offline');
    assert.equal(off.live, false);
    assert.equal(off.updatedAt, offlineSince.toISOString());
    assert.deepEqual(off.heads.map((h: Doc) => [h.state, h.soc, h.powerKw]), [['Offline', 0, 0], ['Offline', 0, 0]]);

    assert.deepEqual(row('STALE').heads.map((h: Doc) => h.state), ['Unknown', 'Unknown']);
    assert.equal(row('SINGLE').heads.length, 1);
    assert.equal(row('SINGLE').status, 'online');  // no Pi5 → OCPP + router only

    // Customer accounts only see their own stations.
    assert.deepEqual((await get('customer')).map((r: { station: { id: string } }) => r.station.id).sort(), ['LIVE', 'OFF']);
    assert.equal((await GET(new NextRequest('http://localhost/api/charging'))).status, 401);
  } finally {
    globals.__mongoClient = previousClient;
  }
});
