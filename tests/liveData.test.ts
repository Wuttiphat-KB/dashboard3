import assert from 'node:assert/strict';
import test from 'node:test';
import { isRecent, stationStatus, stalePlcState, LIVE_TIMEOUT_MS } from '../lib/liveData';

const NOW = Date.parse('2026-11-05T08:00:00Z');

test('isRecent accepts Date, epoch ms and ISO strings inside the window only', () => {
  assert.equal(isRecent(new Date(NOW - 60_000), NOW), true);
  assert.equal(isRecent(NOW - 60_000, NOW), true);
  assert.equal(isRecent(new Date(NOW - 60_000).toISOString(), NOW), true);
  assert.equal(isRecent(new Date(NOW - LIVE_TIMEOUT_MS), NOW), false);
  assert.equal(isRecent(new Date(NOW - 2 * 3_600_000), NOW), false);
  for (const missing of [undefined, null, '', 'not a date']) {
    assert.equal(isRecent(missing, NOW), false, String(missing));
  }
});

test('stationStatus matches the dashboard rule', () => {
  assert.equal(stationStatus([false, false, false]), 'offline');
  assert.equal(stationStatus([true, false, true]), 'degraded');
  assert.equal(stationStatus([true, true, true]), 'online');
  assert.equal(stationStatus([true, true]), 'online');
});

test('stalePlcState: offline station never shows its cached charge state', () => {
  const fresh = new Date(NOW - 10_000);
  const old = new Date(NOW - 20 * 60_000);
  // Offline wins even when the PLC cache looks fresh (heartbeats and PLC time out a moment apart).
  assert.equal(stalePlcState('offline', fresh, NOW), 'Offline');
  assert.equal(stalePlcState('offline', old, NOW), 'Offline');
  // Reachable station whose PLC feed stopped (PLC script / Pi5 down) → Unknown.
  assert.equal(stalePlcState('degraded', old, NOW), 'Unknown');
  assert.equal(stalePlcState('online', old, NOW), 'Unknown');
  assert.equal(stalePlcState('online', undefined, NOW), 'Unknown');
  // Live data is shown as-is.
  assert.equal(stalePlcState('online', fresh, NOW), null);
  assert.equal(stalePlcState('degraded', fresh, NOW), null);
});
