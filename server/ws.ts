import { WebSocketServer, WebSocket } from 'ws';
import { ENV } from './config';
import { SESSION_COOKIE, verifyToken, type VerifiedSession } from '../lib/auth';
import { canViewStation, type CustomerStation } from '../lib/stationAccess';
import { getStationDb } from './mongo';
import type { IncomingMessage } from 'http';

let wss: WebSocketServer | null = null;
const handshakes = new WeakMap<IncomingMessage, VerifiedSession>();
const sessions = new WeakMap<WebSocket, VerifiedSession>();
const customerLookups = new Map<string, Promise<string | null>>();
let stationLookup = (stationId: string): Promise<CustomerStation | null> =>
  getStationDb().collection<CustomerStation & { id: string }>('_stations').findOne({ id: stationId }, { projection: { customer: 1 } });

// stationId → customer name, cached briefly so a burst of MQTT messages costs one lookup.
const customerCache = new Map<string, { name: string | null; at: number }>();
const CUSTOMER_CACHE_MS = 30_000;

/** Coalesce concurrent lookups for the same station; resolves null on errors (never send). */
function stationCustomer(stationId: string): Promise<string | null> {
  const hit = customerCache.get(stationId);
  if (hit && Date.now() - hit.at < CUSTOMER_CACHE_MS) return Promise.resolve(hit.name);
  const pending = customerLookups.get(stationId);
  if (pending) return pending;
  const check = Promise.resolve().then(async () => {
    const station = await stationLookup(stationId);
    const name = station?.customer?.name?.trim() || null;
    customerCache.set(stationId, { name, at: Date.now() });
    return name;
  }).catch(() => null).finally(() => customerLookups.delete(stationId));
  customerLookups.set(stationId, check);
  return check;
}

export function startWs(options: { port?: number; stationLookup?: typeof stationLookup } = {}): WebSocketServer {
  if (options.stationLookup) stationLookup = options.stationLookup;
  wss = new WebSocketServer({
    port: options.port ?? ENV.WS_PORT,
    verifyClient: (info, done) => {
      const token = info.req.headers.cookie?.split(';').map(part => part.trim())
        .find(part => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
      verifyToken(token).then(session => {
        if (!session) { done(false, 401, 'Unauthorized'); return; }
        handshakes.set(info.req, session);
        done(true);
      }).catch(() => done(false, 401, 'Unauthorized'));
    },
  });
  console.log(`[ws] listening on port ${ENV.WS_PORT}`);

  wss.on('connection', (socket, req) => {
    const session = handshakes.get(req);
    if (!session) { socket.close(1008, 'Unauthorized'); return; }
    sessions.set(socket, session);
    console.log(`[ws] client connected (total: ${wss!.clients.size})`);
    socket.on('close', () => {
      console.log(`[ws] client disconnected (total: ${wss!.clients.size})`);
    });
  });

  return wss;
}

/** Broadcast JSON payload to all connected frontends */
export function broadcast(type: string, stationId: string, data: unknown): void {
  if (!wss) return;
  const msg = JSON.stringify({ type, stationId, data, ts: Date.now() });
  for (const client of wss.clients) {
    const session = sessions.get(client);
    if (!session) continue;
    if (Date.now() >= session.expiresAt) { client.close(1008, 'Session expired'); continue; }
    if (session.role === 'admin' && client.readyState === WebSocket.OPEN) {
      client.send(msg);
    } else if (session.role === 'customer' && session.customer) {
      void stationCustomer(stationId).then(name => {
        const allowed = !!name && canViewStation(session, { customer: { name } });
        if (allowed && Date.now() < session.expiresAt && client.readyState === WebSocket.OPEN) {
          client.send(msg);
        }
      });
    }
  }
}

/** Send full snapshot to a single client */
export function sendTo(socket: WebSocket, payload: unknown): void {
  const session = sessions.get(socket);
  // Unscoped snapshots must not bypass station authorization.
  if (session?.role === 'admin' && Date.now() < session.expiresAt && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

export function getWss(): WebSocketServer | null {
  return wss;
}
