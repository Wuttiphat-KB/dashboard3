'use client';

import { useState, useEffect, useSyncExternalStore } from 'react';
import { getFleet, subscribe } from './dataCache';

export interface FleetStation {
  station: {
    id: string;
    name: string;
    displayName: string;
    chargerHeads: number;
    expectedPmPerHead: number;
    expectedPmHead1: number;
    expectedPmHead2: number;
    hasPi5: boolean;
    fanBrand: string;
    hmiBrand?: 'Phoenix' | 'DWIN';
  };
  status: 'online' | 'degraded' | 'offline';
  heartbeat: { online: boolean; lastSeen: string | null };
  pi5:       { online: boolean; lastSeen: string | null };
  router:    {
    online: boolean;
    lastSeen: string | null;
    connstate: string;
    tempRaw?: number;
    rssi?: number;
    conntype?: string;
  };
  meter: {
    meter1Wh: number;
    meter2Wh: number;
    timestamp1: string;
    timestamp2: string;
    stalled1: boolean;
    stalled2: boolean;
  };
  fan?: {
    fans: Record<string, number>;
    timestamp: string;
  };
  powerModule: {
    head: number;
    pmCount: number;
    voltage: number;
    current: number;
    powerKw: number;
    timestamp: string;
    online: boolean;
  }[];
  plcHeads: {
    head: number;
    chargeState: string;
    powerKw: number;
    soc: number;
  }[];
  deviceStatus?: {
    hmi:  string;
    plc1: string;
    plc2: string;
    imd?: string;                  // Vector-only — IMD insulation-monitor device status
    emergencyActive?: boolean;     // Vector-only — true when estop pressed or loop broken
    tempSensorFaults?: string[];   // Vector-only — list of failed cable temp sensors ("t1"...)
    head1: { tempPos: number; tempNeg: number };
    head2: { tempPos: number; tempNeg: number };
  };
  scripts?: {
    faultStatus: { online: boolean; lastHeartbeat: string | null };
    plc:         { online: boolean; lastHeartbeat: string | null };
  };
}

/**
 * Cached fleet data — uses module-level cache so re-mount doesn't reload from scratch.
 * Background refresh every 10s while page is mounted.
 */
export function useFleet() {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const c = getFleet();  // Trigger initial fetch
    const unsub = subscribe(c, () => forceUpdate(n => n + 1));

    // Background refresh — WS pushes invalidate cache instantly,
    // this is a safety net in case WS disconnects
    const timer = setInterval(() => { getFleet(); }, 30_000);

    return () => {
      unsub();
      clearInterval(timer);
    };
  }, []);

  const c = getFleet();
  return {
    fleet: c.data || [],
    loading: c.loading && !c.data,  // only show loading if NO data yet
    error: c.error,
  };
}
