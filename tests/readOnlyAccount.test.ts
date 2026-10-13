import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { getExpectedCredentials, signToken, verifyToken, SESSION_COOKIE } from '../lib/auth';
import { proxy } from '../proxy';
import { POST as login } from '../app/api/auth/login/route';
import { GET as sessionInfo } from '../app/api/auth/session/route';
import { GET as checkPin, POST as unlockConfig } from '../app/api/auth/config-pin/route';

function request(path: string, method = 'GET', token?: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${SESSION_COOKIE}=${token ?? ''}; cfg_pin=1234`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test('PTG login issues a verified viewer session and rejects incorrect passwords', async () => {
  const res = await login(request('/api/auth/login', 'POST', undefined, { username: 'PTG', password: '1234' }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).role, 'viewer');
  const token = res.cookies.get(SESSION_COOKIE)?.value;
  assert.equal((await verifyToken(token))?.role, 'viewer');
  assert.equal(res.cookies.get('cfg_pin')?.maxAge, 0);
  assert.equal((await sessionInfo(request('/api/auth/session', 'GET', token))).status, 200);
  assert.equal((await login(request('/api/auth/login', 'POST', undefined, { username: 'PTG', password: 'wrong' }))).status, 401);

  const admin = getExpectedCredentials();
  const adminRes = await login(request('/api/auth/login', 'POST', undefined, admin));
  assert.equal(adminRes.status, 200);
  assert.equal((await verifyToken(adminRes.cookies.get(SESSION_COOKIE)?.value))?.role, 'admin');
});

test('viewer can browse monitoring data, but cannot enter config pages or mutate APIs', async () => {
  const token = await signToken('PTG');
  for (const path of ['/', '/station/BKK-001', '/alerts', '/maps', '/statistics/energy', '/api/fleet', '/api/stations']) {
    assert.equal((await proxy(request(path, 'GET', token))).headers.get('x-middleware-next'), '1');
  }
  for (const path of ['/config', '/config?edit=BKK-001', '/settings']) {
    assert.equal((await proxy(request(path, 'GET', token))).headers.get('location'), 'http://localhost/');
  }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal((await proxy(request('/api/stations/save', method, token))).status, 403);
  }
  assert.equal((await proxy(request('/api/auth/logout', 'POST', token))).headers.get('x-middleware-next'), '1');
  assert.equal((await proxy(request('/api/stations'))).status, 401);
});

test('mutation endpoints reject viewer even with a config PIN, without relying on proxy', async () => {
  process.env.MONGO_URI = 'mongodb://localhost:27017/read-only-test';
  const { POST: save } = await import('../app/api/stations/save/route');
  const { POST: remove } = await import('../app/api/stations/delete/route');
  const { PATCH: acknowledge } = await import('../app/api/alerts/route');
  const token = await signToken('PTG');
  for (const [path, method, handler] of [
    ['/api/stations/save', 'POST', save],
    ['/api/stations/delete', 'POST', remove],
    ['/api/alerts', 'PATCH', acknowledge],
    ['/api/auth/config-pin', 'POST', unlockConfig],
    ['/api/auth/config-pin', 'GET', checkPin],
  ] as const) {
    assert.equal((await handler(request(path, method, token, method === 'GET' ? undefined : { pin: '1234' }))).status, 403);
    assert.equal((await handler(request(path, method))).status, 401);
  }
});

test('expired, forged, and unrecognized sessions cannot gain edit permissions', async () => {
  assert.equal(await verifyToken(await signToken('PTG', Date.now() - 1)), null);
  assert.equal(await verifyToken(await signToken('unknown-user')), null);
  const viewerToken = await signToken('PTG');
  const forged = btoa(atob(viewerToken).replace('PTG:', `${getExpectedCredentials().username}:`));
  assert.equal(await verifyToken(forged), null);
  const adminToken = await signToken(getExpectedCredentials().username);
  assert.equal((await proxy(request('/config', 'GET', adminToken))).headers.get('x-middleware-next'), '1');
  assert.equal((await proxy(request('/api/stations/save', 'POST', adminToken))).headers.get('x-middleware-next'), '1');
});
