import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AlarmTracker,
  FaultEpisodeTracker,
  KeyedQueue,
  chargerFaultIndexes,
  chargerFaultTopics,
  connectorFromFaultTopic,
  durationSec,
  isAlarmStale,
  ocppStationFromHeartbeat,
  parseExceptionAlarm,
  parseFaultMessage,
  parseTimestamp,
  type FaultMessage,
} from '../lib/chargerFaults';

const at = (s: string) => new Date(s);

function fault(over: Partial<Record<string, unknown>> = {}) {
  return {
    connectorId: 1,
    status: 'Faulted',
    fault: true,
    errorCode: 'OtherError',
    info: 'EmergencyButtonPressed',
    vendorId: 'EgatDimomdService',
    vendorErrorCode: 'SYS_EMERGENCY_STOP',
    timestamp: '2026-11-26T14:15:42.318+07:00',
    ...over,
  };
}

function msg(over: Partial<Record<string, unknown>> = {}): FaultMessage {
  const m = parseFaultMessage(fault(over));
  assert.ok(m, 'fixture must parse');
  return m;
}

// ── topics ───────────────────────────────────────────────────────────────

test('the OCPP station comes from the heartbeat topic, not from the station name', () => {
  assert.equal(ocppStationFromHeartbeat('OCPP/PT100_Ayuthaya3/heartbeat'), 'PT100_Ayuthaya3');
  assert.equal(ocppStationFromHeartbeat('OCPP/26003/heartbeat'), '26003');
  assert.equal(ocppStationFromHeartbeat(' OCPP/Bhutan_Tsirang/heartbeat '), 'Bhutan_Tsirang');
});

test('topics that are not OCPP/<x>/heartbeat give no OCPP station', () => {
  for (const t of ['OCPP/26003/heartbeatPI5', 'OCPP/26003/PLC', '26003', 'OCPP/+/heartbeat', 'OCPP//heartbeat',
    'OCPP/a/b/heartbeat', 'ocpp/26003/heartbeat', '', null, undefined, 5]) {
    assert.equal(ocppStationFromHeartbeat(t), null, String(t));
  }
});

test('topics follow OCPP/<OCPPSTATION>/FaultStatus[/<connectorId>] and /ExceptionAlarm', () => {
  assert.deepEqual(chargerFaultTopics('Bhutan_Tsirang'), {
    faultEvent: 'OCPP/Bhutan_Tsirang/FaultStatus',
    faultLatest0: 'OCPP/Bhutan_Tsirang/FaultStatus/0',
    faultLatest1: 'OCPP/Bhutan_Tsirang/FaultStatus/1',
    faultLatest2: 'OCPP/Bhutan_Tsirang/FaultStatus/2',
    exceptionAlarm: 'OCPP/Bhutan_Tsirang/ExceptionAlarm',
  });
  assert.equal(connectorFromFaultTopic('OCPP/X/FaultStatus/2'), 2);
  assert.equal(connectorFromFaultTopic('OCPP/X/FaultStatus'), null);
});

// ── parsing ──────────────────────────────────────────────────────────────

test('timestamps with a +07:00 offset become the right instant', () => {
  assert.equal(parseTimestamp('2026-11-26T14:15:42.318+07:00')?.toISOString(), '2026-11-26T07:15:42.318Z');
  assert.equal(parseTimestamp(''), null);
  assert.equal(parseTimestamp('not a date'), null);
  assert.equal(parseTimestamp(12345), null);
});

test('a fault message from the spec parses', () => {
  const m = parseFaultMessage(fault());
  assert.deepEqual(m, {
    connectorId: 1, status: 'Faulted', fault: true, errorCode: 'OtherError', info: 'EmergencyButtonPressed',
    vendorId: 'EgatDimomdService', vendorErrorCode: 'SYS_EMERGENCY_STOP', timestamp: at('2026-11-26T07:15:42.318Z'),
  });
});

test('a cleared fault keeps null info / vendorErrorCode', () => {
  const m = parseFaultMessage(fault({ status: 'Available', fault: false, errorCode: 'NoError', info: null, vendorErrorCode: null }));
  assert.equal(m?.fault, false);
  assert.equal(m?.info, null);
  assert.equal(m?.vendorErrorCode, null);
});

test('unusable fault messages are rejected', () => {
  assert.equal(parseFaultMessage('plain text'), null);
  assert.equal(parseFaultMessage(null), null);
  assert.equal(parseFaultMessage([]), null);
  assert.equal(parseFaultMessage(fault({ fault: 'true' })), null);
  assert.equal(parseFaultMessage(fault({ timestamp: undefined })), null);
  assert.equal(parseFaultMessage(fault({ connectorId: -1 })), null);
  assert.equal(parseFaultMessage(fault({ connectorId: 1.5 })), null);
});

test('the connector falls back to the topic suffix only when the payload has none', () => {
  assert.equal(parseFaultMessage(fault({ connectorId: undefined }), 2)?.connectorId, 2);
  assert.equal(parseFaultMessage(fault({ connectorId: undefined })), null);
  assert.equal(parseFaultMessage(fault({ connectorId: 1 }), 2)?.connectorId, 1);
  assert.equal(parseFaultMessage(fault({ connectorId: 0 }))?.connectorId, 0);
});

test('exception alarm messages from the spec parse (dual CSMS and single CSMS)', () => {
  const dual = parseExceptionAlarm({
    message: 'Bhutan_Tsirang (B) disconnected: ConnectionRefusedError; retry in 5.0s', error: 'ConnectionRefusedError',
    source: 'dual_csms', alarm: true, csms: 'B', retryIn: 5.0, timestamp: '2026-11-26T14:15:43.010+07:00',
  });
  assert.equal(dual?.csms, 'B');
  assert.equal(dual?.retryIn, 5);
  assert.equal(dual?.alarm, true);

  const single = parseExceptionAlarm({
    message: 'Bhutan_Tsirang disconnected: ConnectionClosedError; retry in 5s', error: 'ConnectionClosedError',
    source: 'reconnect', alarm: true, attempt: 3, retryIn: 5, timestamp: '2026-11-26T14:15:47.902+07:00',
  });
  assert.equal(single?.csms, null);
  assert.equal(single?.attempt, 3);

  const ok = parseExceptionAlarm({ message: 'x connected', error: null, source: 'heartbeat', alarm: false, timestamp: '2026-11-26T14:16:02.115+07:00' });
  assert.equal(ok?.alarm, false);
  assert.equal(ok?.error, null);
});

test('unusable exception alarm messages are rejected', () => {
  assert.equal(parseExceptionAlarm('x'), null);
  assert.equal(parseExceptionAlarm({ alarm: 1, timestamp: '2026-11-26T14:16:02.115+07:00' }), null);
  assert.equal(parseExceptionAlarm({ alarm: true }), null);
});

// ── fault episodes ───────────────────────────────────────────────────────

test('several faults of one connector share one episode, the clear closes it', () => {
  const t = new FaultEpisodeTracker();
  const a = msg({ vendorErrorCode: 'ISOLATION_FAULT', timestamp: '2026-11-26T14:00:00.000+07:00' });
  const b = msg({ vendorErrorCode: 'PREPARING_TIMEOUT', timestamp: '2026-11-26T14:00:05.000+07:00' });
  const clear = msg({ fault: false, status: 'Available', errorCode: 'NoError', timestamp: '2026-11-26T14:10:00.000+07:00' });

  const d1 = t.onMessage('S1', a, 'event');
  const d2 = t.onMessage('S1', b, 'event');
  const d3 = t.onMessage('S1', clear, 'event');
  assert.deepEqual(d1, { episodeId: a.timestamp, write: true });
  assert.deepEqual(d2, { episodeId: a.timestamp, write: true });
  assert.deepEqual(d3, { episodeId: a.timestamp, write: true });
  assert.equal(t.size, 0);
});

test('a new fault after the clear starts a new episode', () => {
  const t = new FaultEpisodeTracker();
  const first = msg({ timestamp: '2026-11-26T14:00:00.000+07:00' });
  const second = msg({ timestamp: '2026-11-26T15:00:00.000+07:00' });
  t.onMessage('S1', first, 'event');
  t.onMessage('S1', msg({ fault: false, timestamp: '2026-11-26T14:05:00.000+07:00' }), 'event');
  assert.equal(t.onMessage('S1', second, 'event').episodeId?.getTime(), second.timestamp.getTime());
});

test('connectors and stations have separate episodes', () => {
  const t = new FaultEpisodeTracker();
  const c1 = msg({ connectorId: 1, timestamp: '2026-11-26T14:00:00.000+07:00' });
  const c2 = msg({ connectorId: 2, timestamp: '2026-11-26T14:01:00.000+07:00' });
  t.onMessage('S1', c1, 'event');
  assert.equal(t.onMessage('S1', c2, 'event').episodeId?.getTime(), c2.timestamp.getTime());
  assert.equal(t.onMessage('S2', c1, 'event').episodeId?.getTime(), c1.timestamp.getTime());
  assert.equal(t.size, 3);
});

test('a fault:false event with no known episode is still logged (without an episode)', () => {
  const t = new FaultEpisodeTracker();
  assert.deepEqual(t.onMessage('S1', msg({ fault: false }), 'event'), { episodeId: null, write: true });
});

test('retained fault:false with nothing open is only a status refresh (CP.py start / reconnect)', () => {
  const t = new FaultEpisodeTracker();
  assert.deepEqual(t.onMessage('S1', msg({ fault: false, status: 'Available' }), 'retained'), { episodeId: null, write: false });
});

test('retained fault:true opens an episode that the backend missed, and fault:false closes it', () => {
  const t = new FaultEpisodeTracker();
  const open = msg({ timestamp: '2026-11-26T14:00:00.000+07:00' });
  assert.deepEqual(t.onMessage('S1', open, 'retained'), { episodeId: open.timestamp, write: true });
  const closed = msg({ fault: false, timestamp: '2026-11-26T14:30:00.000+07:00' });
  assert.deepEqual(t.onMessage('S1', closed, 'retained'), { episodeId: open.timestamp, write: true });
  assert.equal(t.size, 0);
});

test('event and retained copy of the same message give the same episode (the unique index drops the duplicate)', () => {
  const t = new FaultEpisodeTracker();
  const m = msg({ timestamp: '2026-11-26T14:00:00.000+07:00' });
  const viaRetained = t.onMessage('S1', m, 'retained');
  const viaEvent = t.onMessage('S1', m, 'event');
  assert.equal(viaRetained.episodeId?.getTime(), viaEvent.episodeId?.getTime());
  assert.equal(viaEvent.write, true);
});

test('seeded episodes survive a restart', () => {
  const t = new FaultEpisodeTracker();
  const since = at('2026-11-26T07:00:00.000Z');
  t.seed('S1', 1, since);
  assert.equal(t.openEpisode('S1', 1)?.getTime(), since.getTime());
  const d = t.onMessage('S1', msg({ fault: false }), 'event');
  assert.equal(d.episodeId?.getTime(), since.getTime());
});

// ── exception alarm outages ──────────────────────────────────────────────

test('an outage opens once, repeats are throttled and counted, the connect closes it', () => {
  const t = new AlarmTracker(10_000);
  const lost = { alarm: true, csms: 'B' as string | null };
  assert.deepEqual(t.onMessage('S1', lost, 0), { type: 'open' });
  assert.deepEqual(t.onMessage('S1', lost, 5_000), { type: 'skip' });
  assert.deepEqual(t.onMessage('S1', lost, 9_999), { type: 'skip' });
  assert.deepEqual(t.onMessage('S1', lost, 10_000), { type: 'touch', messages: 3 });
  assert.deepEqual(t.onMessage('S1', lost, 15_000), { type: 'skip' });
  assert.deepEqual(t.onMessage('S1', lost, 20_000), { type: 'touch', messages: 2 });
  assert.deepEqual(t.onMessage('S1', { alarm: false, csms: 'B' }, 21_000), { type: 'close' });
  assert.equal(t.isOpen('S1', 'B'), false);
});

test('CSMS A and B are separate outages, single-CSMS mode (no csms) is its own key', () => {
  const t = new AlarmTracker();
  assert.deepEqual(t.onMessage('S1', { alarm: true, csms: 'A' }, 0), { type: 'open' });
  assert.deepEqual(t.onMessage('S1', { alarm: true, csms: 'B' }, 0), { type: 'open' });
  assert.deepEqual(t.onMessage('S1', { alarm: true, csms: null }, 0), { type: 'open' });
  assert.deepEqual(t.onMessage('S1', { alarm: false, csms: 'A' }, 1), { type: 'close' });
  assert.equal(t.isOpen('S1', 'B'), true);
  assert.equal(t.isOpen('S1', null), true);
});

test('alarm:false with nothing open is ignored (sent on every connect, including CP.py start)', () => {
  const t = new AlarmTracker();
  assert.deepEqual(t.onMessage('S1', { alarm: false, csms: 'A' }, 0), { type: 'ignore' });
});

test('a seeded outage is refreshed, not opened again', () => {
  const t = new AlarmTracker(10_000);
  t.seed('S1', 'A', 0);
  assert.deepEqual(t.onMessage('S1', { alarm: true, csms: 'A' }, 11_000), { type: 'touch', messages: 1 });
});

test('after a timeout close the next alarm opens a new outage', () => {
  const t = new AlarmTracker();
  t.onMessage('S1', { alarm: true, csms: 'A' }, 0);
  t.markClosed('S1', 'A');
  assert.deepEqual(t.onMessage('S1', { alarm: true, csms: 'A' }, 500_000), { type: 'open' });
});

test('an outage is stale only after max(2 min, 3 x retryIn) without a refresh', () => {
  const updatedAt = at('2026-11-26T07:00:00.000Z');
  const base = updatedAt.getTime();
  assert.equal(isAlarmStale({ updatedAt, retryIn: 5 }, base + 119_000), false);
  assert.equal(isAlarmStale({ updatedAt, retryIn: 5 }, base + 121_000), true);
  assert.equal(isAlarmStale({ updatedAt, retryIn: 100 }, base + 121_000), false);
  assert.equal(isAlarmStale({ updatedAt, retryIn: 100 }, base + 301_000), true);
  assert.equal(isAlarmStale({ updatedAt }, base + 121_000), true);
});

test('duration is whole seconds and never negative', () => {
  assert.equal(durationSec(at('2026-11-26T07:00:00.000Z'), at('2026-11-26T07:01:30.600Z')), 91);
  assert.equal(durationSec(at('2026-11-26T07:00:10.000Z'), at('2026-11-26T07:00:00.000Z')), 0);
});

// ── queue ────────────────────────────────────────────────────────────────

test('jobs with the same key run one at a time in submission order, other keys do not wait', async () => {
  const q = new KeyedQueue();
  const log: string[] = [];
  const slow = (name: string, ms: number) => async () => {
    log.push(`start ${name}`);
    await new Promise(r => setTimeout(r, ms));
    log.push(`end ${name}`);
  };
  await Promise.all([
    q.run('a', slow('a1', 30)),
    q.run('a', slow('a2', 1)),
    q.run('b', slow('b1', 1)),
  ]);
  assert.ok(log.indexOf('end a1') < log.indexOf('start a2'), log.join(' | '));
  assert.ok(log.indexOf('end b1') < log.indexOf('end a1'), log.join(' | '));
});

test('a failing job does not block the next one with the same key', async () => {
  const q = new KeyedQueue();
  const failing = q.run('a', async () => { throw new Error('boom'); });
  const next = q.run('a', async () => 'ok');
  await assert.rejects(failing, /boom/);
  assert.equal(await next, 'ok');
});

// ── indexes ──────────────────────────────────────────────────────────────

test('index specs: unique keys, one open outage per CSMS, TTL on server-side dates only', () => {
  const specs = chargerFaultIndexes({});
  const byName = (c: string, n: string) => specs.find(s => s.collection === c && s.options.name === n);

  assert.equal(byName('_fault_status', 'station_connector')?.options.unique, true);
  assert.equal(byName('_fault_status_log', 'dedupe_message')?.options.unique, true);
  assert.deepEqual(Object.keys(byName('_fault_status_log', 'dedupe_message')!.keys),
    ['stationId', 'connectorId', 'vendorErrorCode', 'fault', 'timestamp']);

  const open = byName('_exception_alarms', 'one_open_per_csms')!;
  assert.equal(open.options.unique, true);
  assert.deepEqual(open.options.partialFilterExpression, { active: true });

  assert.deepEqual(byName('_fault_status_log', 'ttl_received')!.keys, { receivedAt: 1 });
  assert.deepEqual(byName('_exception_alarms', 'ttl_closed')!.keys, { closedAt: 1 });
  for (const s of specs.filter(s => s.options.expireAfterSeconds !== undefined)) {
    assert.ok(!('timestamp' in s.keys) && !('startedAt' in s.keys) && !('endedAt' in s.keys), `TTL must not use charger time: ${s.options.name}`);
  }
});

test('retention defaults to 365 days and follows the env vars (minimum 1 day)', () => {
  const ttl = (env: Record<string, string>, c: string, n: string) =>
    chargerFaultIndexes(env).find(s => s.collection === c && s.options.name === n)!.options.expireAfterSeconds;
  assert.equal(ttl({}, '_fault_status_log', 'ttl_received'), 365 * 86_400);
  assert.equal(ttl({ FAULT_LOG_RETENTION_DAYS: '30' }, '_fault_status_log', 'ttl_received'), 30 * 86_400);
  assert.equal(ttl({ EXCEPTION_ALARM_RETENTION_DAYS: '90' }, '_exception_alarms', 'ttl_closed'), 90 * 86_400);
  assert.equal(ttl({ FAULT_LOG_RETENTION_DAYS: '0' }, '_fault_status_log', 'ttl_received'), 365 * 86_400);
  assert.equal(ttl({ FAULT_LOG_RETENTION_DAYS: 'abc' }, '_fault_status_log', 'ttl_received'), 365 * 86_400);
});
