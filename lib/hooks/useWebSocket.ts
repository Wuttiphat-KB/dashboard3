'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { getWsUrl } from '@/lib/config';

export interface WsMessage {
  type: string;       // 'heartbeat' | 'meter' | 'powerModule' | 'fanRpm' | 'temperature' | 'plc' | 'alert' | 'scriptHb'
  stationId: string;
  data: any;
  ts: number;
}

type MessageHandler = (msg: WsMessage) => void;

export function useWebSocket(onMessage?: MessageHandler) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const handlersRef = useRef<Set<MessageHandler>>(new Set());

  // Keep onMessage ref in sync
  useEffect(() => {
    if (onMessage) handlersRef.current.add(onMessage);
    return () => { if (onMessage) handlersRef.current.delete(onMessage); };
  }, [onMessage]);

  useEffect(() => {
    const wsUrl = getWsUrl();
    if (!wsUrl) return;

    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let closed = false;

    function connect() {
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[ws] connected');
        setConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg: WsMessage = JSON.parse(event.data);
          for (const handler of handlersRef.current) {
            handler(msg);
          }
        } catch {}
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (!closed) {
          console.log('[ws] disconnected, reconnecting in 3s...');
          reconnectTimer = setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      closed = true;
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  return { connected, ws: wsRef };
}

/**
 * Subscribe to specific WS message types for a station.
 * Returns latest data for each type subscribed.
 */
export function useStationWs(stationId: string) {
  const [heartbeats, setHeartbeats]   = useState<Record<string, any>>({});
  const [meter, setMeter]             = useState<any>(null);
  const [powerModule, setPowerModule] = useState<any>(null);
  const [fanRpm, setFanRpm]           = useState<any>(null);
  const [temperature, setTemperature] = useState<any>(null);
  const [plc, setPlc]                 = useState<any>(null);
  const [alerts, setAlerts]           = useState<any[]>([]);
  const [scripts, setScripts]         = useState<Record<string, any>>({});

  const handler = useCallback((msg: WsMessage) => {
    if (msg.stationId !== stationId) return;

    switch (msg.type) {
      case 'heartbeat':
        setHeartbeats(prev => ({ ...prev, [msg.data.device]: msg.data }));
        break;
      case 'meter':
        setMeter(msg.data);
        break;
      case 'powerModule':
        setPowerModule(msg.data);
        break;
      case 'fanRpm':
        setFanRpm(msg.data);
        break;
      case 'temperature':
        setTemperature(msg.data);
        break;
      case 'plc':
        setPlc(msg.data);
        break;
      case 'alert':
        setAlerts(prev => [msg.data, ...prev].slice(0, 50));
        break;
      case 'scriptHb':
        setScripts(prev => ({ ...prev, [msg.data.script]: msg.data }));
        break;
    }
  }, [stationId]);

  const { connected } = useWebSocket(handler);

  return {
    connected,
    heartbeats,
    meter,
    powerModule,
    fanRpm,
    temperature,
    plc,
    alerts,
    scripts,
  };
}
