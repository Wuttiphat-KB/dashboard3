import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { getExpectedCredentials, signToken, verifyToken, SESSION_COOKIE } from '../lib/auth';
import { proxy } from '../proxy';
import { POST as login } from '../app/api/auth/login/route';
import { GET as sessionInfo } from '../app/api/auth/session/route';
import { GET as checkPin, POST as unlockConfig } from '../app/api/auth/config-pin/route';
import { hashPassword, invalidateUserCache } from '../lib/users';

type Doc = Record<string, any>;
const CUSTOMER = { username: 'pt.user', role: 'customer' as const, customer: 'PT' };
const ADMIN = () => ({ username: getExpectedCredentials().username, role: 'admin' as const });

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

/** Minimal in-memory Mongo with just the user + audit collections. */
async function withFakeUsers(users: Doc[], fn: (audit: Doc[]) => Promise<void>) {
  process.env.MONGO_URI ??= 'mongodb://localhost:27017/users-test';
  const audit: Doc[] = [];
  const globals = globalThis as typeof globalThis & { __mongoClient?: unknown };
  const previous = globals.__mongoClient;
  globals.__mongoClient = {
    db: () => ({
      collection: (name: string) => ({
        createIndex: async () => 'ok',
        findOne: async (q: Doc) => {
          if (name !== '_users') return null;
          const u = users.find(x => x.username === q.username);
          return u ? structuredClone(u) : null;
        },
        updateOne: async () => ({ matchedCount: 1 }),
        insertOne: async (doc: Doc) => { if (name === '_audit_log') audit.push(doc); return { acknowledged: true }; },
      }),
    }),
  };
  invalidateUserCache();
  try { await fn(audit); } finally { globals.__mongoClient = previous; invalidateUserCache(); }
}

test('database users log in with their role/customer; wrong passwords and disabled users are rejected', async () => {
  const users = [
    { username: 'pt.user', role: 'customer', customer: 'PT', passwordHash: await hashPassword('correct-horse') },
    { username: 'ops.admin', role: 'admin', passwordHash: await hashPassword('admin-pass-1') },
    { username: 'gone', role: 'customer', customer: 'PT', disabled: true, passwordHash: await hashPassword('whatever-1') },
  ];
  await withFakeUsers(users, async audit => {
    const res = await login(request('/api/auth/login', 'POST', undefined, { username: 'PT.User', password: 'correct-horse' }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.role, 'customer');
    assert.equal(body.customer, 'PT');
    const token = res.cookies.get(SESSION_COOKIE)?.value;
    const session = await verifyToken(token);
    assert.equal(session?.role, 'customer');
    assert.equal(session?.customer, 'PT');
    assert.equal(res.cookies.get('cfg_pin')?.maxAge, 0);
    assert.equal((await sessionInfo(request('/api/auth/session', 'GET', token))).status, 200);

    assert.equal((await login(request('/api/auth/login', 'POST', undefined, { username: 'pt.user', password: 'wrong' }))).status, 401);
    assert.equal((await login(request('/api/auth/login', 'POST', undefined, { username: 'nobody', password: 'x' }))).status, 401);
    assert.equal((await login(request('/api/auth/login', 'POST', undefined, { username: 'gone', password: 'whatever-1' }))).status, 401);

    const dbAdmin = await login(request('/api/auth/login', 'POST', undefined, { username: 'ops.admin', password: 'admin-pass-1' }));
    assert.equal((await verifyToken(dbAdmin.cookies.get(SESSION_COOKIE)?.value))?.role, 'admin');

    const envAdmin = await login(request('/api/auth/login', 'POST', undefined, getExpectedCredentials()));
    assert.equal(envAdmin.status, 200);
    assert.equal((await verifyToken(envAdmin.cookies.get(SESSION_COOKIE)?.value))?.role, 'admin');

    await new Promise(r => setTimeout(r, 20));
    assert.ok(audit.some(e => e.action === 'login' && e.username === 'pt.user'));
    assert.ok(audit.some(e => e.action === 'login_failed' && e.username === 'pt.user' && e.ok === false));
  });
});

test('customer can browse monitoring data, but cannot enter admin pages or mutate APIs', async () => {
  const token = await signToken(CUSTOMER);
  for (const path of ['/', '/station/BKK-001', '/alerts', '/maps', '/statistics/energy', '/api/fleet', '/api/stations', '/api/energy/export', '/api/vsecc-logs?stationId=X']) {
    assert.equal((await proxy(request(path, 'GET', token))).headers.get('x-middleware-next'), '1');
  }
  for (const path of ['/config', '/config?edit=BKK-001', '/settings', '/users', '/audit']) {
    assert.equal((await proxy(request(path, 'GET', token))).headers.get('location'), 'http://localhost/');
  }
  for (const path of ['/api/users', '/api/users/someone', '/api/audit']) {
    assert.equal((await proxy(request(path, 'GET', token))).status, 403);
  }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal((await proxy(request('/api/stations/save', method, token))).status, 403);
  }
  assert.equal((await proxy(request('/api/auth/logout', 'POST', token))).headers.get('x-middleware-next'), '1');
  assert.equal((await proxy(request('/api/stations'))).status, 401);
});

test('mutation and admin endpoints reject customers even with a config PIN, without relying on proxy', async () => {
  await withFakeUsers([{ username: 'pt.user', role: 'customer', customer: 'PT' }], async () => {
    const { POST: save } = await import('../app/api/stations/save/route');
    const { POST: remove } = await import('../app/api/stations/delete/route');
    const { PATCH: acknowledge } = await import('../app/api/alerts/route');
    const { GET: listUsers, POST: createUser } = await import('../app/api/users/route');
    const { GET: auditLog } = await import('../app/api/audit/route');
    const token = await signToken(CUSTOMER);
    for (const [path, method, handler] of [
      ['/api/stations/save', 'POST', save],
      ['/api/stations/delete', 'POST', remove],
      ['/api/alerts', 'PATCH', acknowledge],
      ['/api/auth/config-pin', 'POST', unlockConfig],
      ['/api/auth/config-pin', 'GET', checkPin],
      ['/api/users', 'GET', listUsers],
      ['/api/users', 'POST', createUser],
      ['/api/audit', 'GET', auditLog],
    ] as const) {
      assert.equal((await (handler as any)(request(path, method, token, method === 'GET' ? undefined : { pin: '1234' }))).status, 403, `${method} ${path}`);
      assert.equal((await (handler as any)(request(path, method))).status, 401, `${method} ${path} anonymous`);
    }
  });
});

test('disabled, deleted or re-scoped users lose API access even with a still-valid token', async () => {
  const users: Doc[] = [{ username: 'pt.user', role: 'customer', customer: 'PT' }];
  await withFakeUsers(users, async () => {
    const token = await signToken(CUSTOMER);
    assert.equal((await sessionInfo(request('/api/auth/session', 'GET', token))).status, 200);
    users[0].disabled = true; invalidateUserCache();
    assert.equal((await sessionInfo(request('/api/auth/session', 'GET', token))).status, 401);
    users[0].disabled = false; users[0].customer = 'OTHER'; invalidateUserCache();
    assert.equal((await sessionInfo(request('/api/auth/session', 'GET', token))).status, 401);
    users.length = 0; invalidateUserCache();
    assert.equal((await sessionInfo(request('/api/auth/session', 'GET', token))).status, 401);
  });
});

test('expired, forged, legacy and malformed tokens are rejected', async () => {
  assert.equal(await verifyToken(await signToken(CUSTOMER, Date.now() - 1)), null);
  assert.equal(await verifyToken(await signToken({ username: 'x', role: 'customer' })), null);    // customer without scope
  assert.equal(await verifyToken(await signToken({ username: 'x', role: 'viewer' as any })), null); // unknown role
  const customerToken = await signToken(CUSTOMER);
  const [v, payload, sig] = customerToken.split('.');
  const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  const forgedPayload = Buffer.from(JSON.stringify({ ...json, r: 'admin' })).toString('base64url');
  assert.equal(await verifyToken(`${v}.${forgedPayload}.${sig}`), null);
  assert.equal(await verifyToken(btoa(`${getExpectedCredentials().username}:${Date.now() + 1e6}:deadbeef`)), null); // old v1 format
  assert.equal(await verifyToken('garbage'), null);

  const adminToken = await signToken(ADMIN());
  assert.equal((await proxy(request('/config', 'GET', adminToken))).headers.get('x-middleware-next'), '1');
  assert.equal((await proxy(request('/users', 'GET', adminToken))).headers.get('x-middleware-next'), '1');
  assert.equal((await proxy(request('/api/stations/save', 'POST', adminToken))).headers.get('x-middleware-next'), '1');
});
