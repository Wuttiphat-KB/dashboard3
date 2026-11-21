import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeInformation, firmwareOf, modelOf, infoView } from '../lib/vseccInfo';

const SAMPLE = {
  firmwareVersion: '3.12.0',
  model: 'vSECC.single',
  serialNumber: 'SN-0001',
  productNumber: 'P-100',
  license: { features: ['ocpp2', 'iso15118'] },
  uptime: 123456,
  nothing: null,
  ready: true,
};

test('sanitizeInformation keeps scalars, turns nested values into text, rejects non-objects', () => {
  const f = sanitizeInformation(SAMPLE)!;
  assert.equal(f.firmwareVersion, '3.12.0');
  assert.equal(f.uptime, 123456);
  assert.equal(f.nothing, null);
  assert.equal(f.ready, true);
  assert.equal(f.license, '{"features":["ocpp2","iso15118"]}');
  for (const bad of [null, undefined, 'text', 42, [], [1, 2]]) assert.equal(sanitizeInformation(bad), null, String(bad));
  assert.equal(sanitizeInformation({}), null);
});

test('sanitizeInformation truncates long text and caps the number of fields', () => {
  assert.equal((sanitizeInformation({ a: 'x'.repeat(1000) })!.a as string).length, 300);
  const many = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, i]));
  assert.equal(Object.keys(sanitizeInformation(many)!).length, 40);
});

test('firmwareOf / modelOf ignore case and punctuation and prefer the exact firmwareVersion key', () => {
  assert.equal(firmwareOf({ Firmware_Version: '3.11.0' }), '3.11.0');
  assert.equal(firmwareOf({ firmware: 'old', firmwareVersion: '3.12.0' }), '3.12.0');
  assert.equal(firmwareOf({ firmwareVersion: '' }), null);
  assert.equal(firmwareOf({ model: 'x' }), null);
  assert.equal(firmwareOf(null), null);
  assert.equal(modelOf({ Model: 'vSECC.single' }), 'vSECC.single');
});

test('infoView: customers get firmware + model only, admins get everything', () => {
  const src = { info: sanitizeInformation(SAMPLE), infoAt: '2026-11-20T10:00:00.000Z', infoError: 'HTTP 404' };
  const customer = infoView(src, false);
  assert.deepEqual(customer, { firmwareVersion: '3.12.0', model: 'vSECC.single', infoAt: '2026-11-20T10:00:00.000Z' });
  assert.equal('info' in customer, false);
  assert.equal('infoError' in customer, false);
  const admin = infoView(src, true);
  assert.equal(admin.info?.serialNumber, 'SN-0001');
  assert.equal(admin.infoError, 'HTTP 404');
});

test('infoView copes with a vSECC that was never read', () => {
  assert.deepEqual(infoView({}, false), { firmwareVersion: null, model: null, infoAt: null });
  assert.equal(infoView({}, true).firmwareVersion, null);
});
