import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildWarrantyPlan, type LiveStation, type WarrantySourceRow } from '../scripts/warrantyMapping';

const row = (over: Partial<WarrantySourceRow>): WarrantySourceRow => ({
  sheetRow: 1, sheetName: 'PT x', stationId: 'A', commissioningDate: '2024-06-27', warrantyYears: null, confidence: 'high', action: 'apply', ...over,
});
const st = (over: Partial<LiveStation> = {}): LiveStation => ({ id: 'A', name: 'A', ...over });

test('fills blank fields, writes only what the sheet has', () => {
  const plan = buildWarrantyPlan([row({}), row({ sheetRow: 2, stationId: 'B', warrantyYears: 5 })], [st(), st({ id: 'B', name: 'B' })]);
  assert.equal(plan.counts.update, 2);
  assert.deepEqual(plan.items[0].changes, { commissioningDate: '2024-06-27' });            // no warrantyYears invented
  assert.deepEqual(plan.items[1].changes, { commissioningDate: '2024-06-27', warrantyYears: 5 });
});

test('never overwrites a different saved value unless --overwrite; equal values are unchanged', () => {
  const live = [st({ commissioningDate: '2023-01-01', warrantyYears: 3 })];
  const src = [row({ warrantyYears: 5 })];
  const kept = buildWarrantyPlan(src, live);
  assert.equal(kept.items[0].status, 'conflict');
  assert.deepEqual(kept.items[0].changes, {});
  assert.equal(kept.items[0].conflicts.length, 2);
  assert.equal(kept.blocking.length, 0);                                                    // conflicts never block --apply
  const forced = buildWarrantyPlan(src, live, { overwrite: true });
  assert.deepEqual(forced.items[0].changes, { commissioningDate: '2024-06-27', warrantyYears: 5 });
  const same = buildWarrantyPlan([row({})], [st({ commissioningDate: '2024-06-27' })]);
  assert.equal(same.items[0].status, 'unchanged');
});

test('a conflict on one field does not stop the blank field from being filled', () => {
  const plan = buildWarrantyPlan([row({ warrantyYears: 2 })], [st({ commissioningDate: '2023-01-01' })]);
  assert.equal(plan.items[0].status, 'update');
  assert.deepEqual(plan.items[0].changes, { warrantyYears: 2 });
  assert.equal(plan.items[0].conflicts[0].field, 'commissioningDate');
});

test('hold / unmatched rows are never applied; --only-high skips medium matches', () => {
  const src = [row({ action: 'hold' }), row({ sheetRow: 2, stationId: null, action: 'unmatched' }), row({ sheetRow: 3, confidence: 'medium' })];
  const plan = buildWarrantyPlan(src, [st()], { onlyHigh: true });
  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].status, 'skipped-medium');
  assert.deepEqual(plan.notApplied, { hold: 1, unmatched: 1 });
  assert.equal(buildWarrantyPlan(src, [st()]).items[0].status, 'update');
});

test('missing stations, invalid values and duplicate targets are blocking problems', () => {
  assert.equal(buildWarrantyPlan([row({ stationId: 'ZZZ' })], [st()]).items[0].status, 'station-missing');
  assert.equal(buildWarrantyPlan([row({ commissioningDate: '2024-02-30' })], [st()]).items[0].status, 'invalid');
  assert.equal(buildWarrantyPlan([row({ warrantyYears: 2.25 })], [st()]).items[0].status, 'invalid');
  const dup = buildWarrantyPlan([row({}), row({ sheetRow: 2 })], [st()]);
  assert.deepEqual(dup.items.map(item => item.status), ['duplicate-source', 'duplicate-source']);
  assert.equal(dup.blocking.length, 2);
});

// Sanity checks on the real data file shipped with the script.
const source = JSON.parse(readFileSync(resolve(__dirname, '../outputs/warranty-mapping-20261125/warranty-source.json'), 'utf8')) as WarrantySourceRow[];

test('warranty-source.json: every row to be applied is valid and targets a distinct station', () => {
  const live = source.filter(r => r.stationId).map(r => st({ id: r.stationId!, name: r.stationId! }));
  const plan = buildWarrantyPlan(source, live);
  assert.equal(plan.blocking.length, 0, JSON.stringify(plan.blocking));
  assert.equal(plan.items.length, source.filter(r => r.action === 'apply').length);
  assert.ok(source.every(r => r.action !== 'apply' || (r.stationId && r.commissioningDate)));
});

test('warranty-source.json: warranty years only where the sheet states them', () => {
  const withYears = source.filter(r => r.warrantyYears !== null).map(r => [r.sheetRow, r.warrantyYears]);
  assert.deepEqual(withYears, [[3, 2], [4, 5], [7, 5], [161, 2]]);
  assert.equal(source.find(r => r.sheetRow === 161)!.action, 'hold');   // ESCO Rayong: supply only, not applied
  assert.equal(source.find(r => r.sheetRow === 157)!.action, 'hold');   // KPN Rayong: 30% payment invoice date
});
