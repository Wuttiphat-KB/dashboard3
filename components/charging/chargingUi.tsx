'use client';

import type { CSSProperties } from 'react';
import { classifyState, type ChargeClass } from '@/lib/charging';

/**
 * Colours per state group. Charging stays amber + pulsing like the Overview
 * cards; Available is green, a connected-but-not-charging session blue.
 */
export const STATE_STYLE: Record<ChargeClass, {
  label: string; badge: string; led: string; ledStyle?: CSSProperties;
}> = {
  charging: { label: 'Charging',   badge: 'badge-warn',    led: 'led-warn led-pulse' },
  // globals.css has no .led-info, so the blue LED is styled inline.
  session:  { label: 'In session', badge: 'badge-info',    led: '', ledStyle: { background: 'var(--info)', boxShadow: '0 0 7px var(--info)' } },
  ready:    { label: 'Available',  badge: 'badge-ok',      led: 'led-ok' },
  fault:    { label: 'Fault',      badge: 'badge-error',   led: 'led-error' },
  offline:  { label: 'Offline',    badge: 'badge-offline', led: 'led-offline' },
  unknown:  { label: 'No data',    badge: 'badge-offline', led: 'led-offline' },
};

/** The raw PLC state ("PreCharge", "Finishing"…) coloured by its group. */
export function StateBadge({ state }: { state: string }) {
  const st = STATE_STYLE[classifyState(state)];
  return (
    <span className={`badge ${st.badge}`} style={{ fontSize: 11 }}>
      <span className={`led ${st.led}`} style={st.ledStyle} />
      {state}
    </span>
  );
}

/** Same thresholds as the station page's PLC tab. */
export function socColor(soc: number): string {
  return soc < 20 ? 'var(--error)' : soc < 50 ? 'var(--warn)' : 'var(--ok)';
}

export function fmtKw(kw: number): string {
  return kw >= 10 || kw === 0 ? kw.toFixed(0) : kw.toFixed(1);
}
