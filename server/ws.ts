import { WebSocketServer, WebSocket } from 'ws';
import { ENV } from './config';

let wss: WebSocketServer | null = null;

export function startWs(): WebSocketServer {
  wss = new WebSocketServer({ port: ENV.WS_PORT });
  console.log(`[ws] listening on port ${ENV.WS_PORT}`);

  wss.on('connection', (socket) => {
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
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

/** Send full snapshot to a single client */
export function sendTo(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

export function getWss(): WebSocketServer | null {
  return wss;
}
