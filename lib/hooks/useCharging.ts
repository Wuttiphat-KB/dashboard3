'use client';

import { useState, useEffect } from 'react';
import { getCharging, subscribe } from './dataCache';

/**
 * Live per-head charging snapshot (/api/charging). Refreshed on PLC / heartbeat
 * WebSocket traffic (AppShell → invalidateCharging) and polled as a safety net.
 */
export function useCharging() {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const c = getCharging();
    const unsub = subscribe(c, () => forceUpdate(n => n + 1));
    const timer = setInterval(() => { getCharging(); }, 15_000);
    return () => { unsub(); clearInterval(timer); };
  }, []);

  const c = getCharging();
  return {
    stations: c.data || [],
    // Derived from data/error only (same hydration reasoning as useFleet).
    loading: !c.data && !c.error,
    error: c.error,
    fetchedAt: c.timestamp,
  };
}
