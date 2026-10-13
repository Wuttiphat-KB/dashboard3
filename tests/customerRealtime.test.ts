import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { getExpectedCredentials, signToken, SESSION_COOKIE } from '../lib/auth';

test('realtime sockets authenticate and deliver only PT station messages to PTG', { timeout: 10000 }, async () => {
  process.env.MONGO_URI = 'mongodb://localhost:27017/realtime-test';
  process.env.MQTT_URL = 'mqtt://localhost:1883';
  const { startWs, broadcast, sendTo } = await import('../server/ws');
  const customers = new Map([['PT-1', 'PT'], ['PT-2', 'PT'], ['OTHER-1', 'OTHER']]);
  const server = startWs({ port: 0, stationLookup: async id => {
    if (id === 'DB-FAILURE') throw new Error('Unavailable');
    return customers.has(id) ? { customer: { name: customers.get(id) } } : null;
  } });
  const sockets: WebSocket[] = [];
  try {
    if (!server.address()) await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const url = `ws://127.0.0.1:${address.port}`;
    const anonymous = new WebSocket(url);
    sockets.push(anonymous);
    const rejected = new Promise<number>(resolve => anonymous.on('unexpected-response', (_req, response) => {
      resolve(response.statusCode!);
      response.resume();
    }));
    assert.equal(await rejected, 401);
    anonymous.on('error', () => {});
    anonymous.terminate();

    const viewer = new WebSocket(url, { headers: { Cookie: `${SESSION_COOKIE}=${await signToken('PTG')}` } });
    const admin = new WebSocket(url, { headers: { Cookie: `${SESSION_COOKIE}=${await signToken(getExpectedCredentials().username)}` } });
    sockets.push(viewer, admin);
    await Promise.all([once(viewer, 'open'), once(admin, 'open')]);
    const received: string[] = [];
    viewer.on('message', raw => received.push(JSON.parse(String(raw)).stationId));
    broadcast('meter', 'OTHER-1', { secret: 'other customer' });
    broadcast('meter', 'DB-FAILURE', { secret: 'fail closed' });
    broadcast('meter', 'MISSING', { secret: 'unassigned' });
    const viewerMessage = once(viewer, 'message');
    const adminMessage = once(admin, 'message');
    broadcast('meter', 'PT-1', { meter1: 10 });
    await viewerMessage;
    await adminMessage;
    assert.deepEqual(received, ['PT-1']);

    // Customer reassignment must immediately stop delivery on existing sockets.
    customers.set('PT-1', 'OTHER');
    for (const socket of server.clients) sendTo(socket, { stationId: 'UNSCOPED', secret: 'full snapshot' });
    broadcast('meter', 'PT-1', { secret: 'revoked' });
    const next = once(viewer, 'message');
    broadcast('meter', 'PT-2', { meter1: 20 });
    await next;
    assert.deepEqual(received, ['PT-1', 'PT-2']);
  } finally {
    for (const socket of sockets) { socket.on('error', () => {}); socket.terminate(); }
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
