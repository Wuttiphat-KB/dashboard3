/**
 * Charging overview — per-head snapshot served by /api/charging, built from the
 * PLC topic payload (Phoenix shape; the Vector handler writes the same keys).
 * Pure helpers only: imported by the API route and by the page.
 */
import type { StationStatus } from './liveData';

export interface ChargingHead {
  head: number;
  /** PLC chargeState, or 'Offline' / 'Unknown' when the payload isn't live. */
  state: string;
  soc: number;            // %
  powerKw: number;
  maxPowerKw: number;     // head's current power ceiling (PLC maxPower, W → kW); 0 = not reported
  voltage: number;        // presentVoltage, V
  current: number;        // presentCurrent, A
  targetVoltage: number;  // requested by the vehicle, V
  targetCurrent: number;  // requested by the vehicle, A
  cableTempC: number;     // hotter of the two connector sensors
  activeModules: number;  // activeMld
  finishing: boolean;
  evStopped: boolean;     // LX_EvStoppedCharging
  evseStopped: boolean;   // LX_EvseStoppedCharging
  insulationFault: boolean;
  error: string;          // errorMessage while headError ≠ 0
}

export interface ChargingStation {
  /** `zerotierIp` is '' / absent when none is configured — ZerotierCopy then renders nothing. */
  station: { id: string; name: string; displayName: string; chargerHeads: number; zerotierIp?: string };
  status: StationStatus;
  /** False → station offline or PLC payload stale; head values are blanked. */
  live: boolean;
  /** When the backend last received a PLC payload (ISO), if ever. */
  updatedAt: string | null;
  heads: ChargingHead[];
}

/** PLC values arrive as strings ("43", "360.6") and sometimes "var not found" / null. */
function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim());
  return Number.isFinite(n) ? n : 0;
}
function flag(v: unknown): boolean {
  return num(v) === 1;
}

/**
 * One head's snapshot. `p` is the PLC payload, or null when it isn't live — then
 * every value is blank and `deadState` ('Offline' | 'Unknown') is the state.
 */
export function headFromPlc(p: Record<string, unknown> | null, h: number, deadState: string): ChargingHead {
  if (!p) {
    return {
      head: h, state: deadState, soc: 0, powerKw: 0, maxPowerKw: 0, voltage: 0, current: 0,
      targetVoltage: 0, targetCurrent: 0, cableTempC: 0, activeModules: 0,
      finishing: false, evStopped: false, evseStopped: false, insulationFault: false, error: '',
    };
  }
  const state = String(p[`chargeState${h}`] ?? p[`H${h} chargeState`] ?? 'Unknown').trim() || 'Unknown';
  const headError = num(p[`head${h}Error`] ?? p[`H${h} Error`]);
  return {
    head: h,
    state,
    soc:           num(p[`SOC${h}`] ?? p[`H${h} SOC`]),
    powerKw:       num(p[`powerKw${h}`] ?? p[`H${h} powerKw`]),
    maxPowerKw:    num(p[`maxPower${h}`]) / 1000,
    voltage:       num(p[`presentVoltage${h}`]),
    current:       num(p[`presentCurrent${h}`]),
    targetVoltage: num(p[`targetVoltage${h}`]),
    targetCurrent: num(p[`targetCurrent${h}`]),
    cableTempC:    Math.max(num(p[`temp1Head${h}`]), num(p[`temp2Head${h}`])),
    activeModules: num(p[`activeMld${h}`]),
    finishing:     flag(p[`finishing${h}`]),
    evStopped:     flag(p[`LX_EvStoppedCharging${h}`]),
    evseStopped:   flag(p[`LX_EvseStoppedCharging${h}`]),
    insulationFault: flag(p[`insulationFault${h}`]),
    error:         headError !== 0 ? String(p[`errorMessage${h}`] ?? '').trim() : '',
  };
}

export type ChargeClass = 'charging' | 'session' | 'ready' | 'fault' | 'offline' | 'unknown';

/**
 * Groups the open-ended PLC state strings:
 *   charging — energy flowing
 *   session  — vehicle connected but not (yet / any more) charging: PreCharge, Connected, Finishing…
 *   ready    — free for the next vehicle
 *   fault, offline, unknown
 */
export function classifyState(state: string): ChargeClass {
  const s = state.trim().toLowerCase();
  if (s === 'charging') return 'charging';
  if (s === 'offline') return 'offline';
  if (!s || s === 'unknown' || s === 'n/a') return 'unknown';
  if (s.includes('fault') || s.includes('error')) return 'fault';
  if (s === 'ready' || s === 'available' || s === 'idle') return 'ready';
  return 'session';
}

/** A vehicle is connected — SOC, power and voltage/current mean something. */
export function hasSession(cls: ChargeClass): boolean {
  return cls === 'charging' || cls === 'session';
}

export interface HeadFlag { label: string; tone: 'error' | 'info' }

/** Conditions worth a chip next to the head, without repeating the state or each other. */
export function headFlags(h: ChargingHead): HeadFlag[] {
  const out: HeadFlag[] = [];
  const add = (label: string, tone: HeadFlag['tone']) => {
    const key = label.trim().toLowerCase();
    if (!key || key === h.state.trim().toLowerCase() || out.some(f => f.label.toLowerCase() === key)) return;
    out.push({ label: label.trim(), tone });
  };
  if (h.error) add(h.error, 'error');
  if (h.insulationFault && !h.error.toLowerCase().includes('insulation')) add('Insulation fault', 'error');
  if (h.finishing)   add('Finishing', 'info');
  if (h.evStopped)   add('EV stopped', 'info');
  if (h.evseStopped) add('EVSE stopped', 'info');
  return out;
}

/** Does any head of this cabinet fall in one of these groups? */
export function stationHas(s: ChargingStation, ...groups: ChargeClass[]): boolean {
  return s.heads.some(h => groups.includes(classifyState(h.state)));
}

/**
 * Counts for the KPI row, per cabinet like the filters (a cabinet with one head
 * charging and one free counts under both).
 */
export function summarizeStations(stations: ChargingStation[]) {
  return {
    stations:  stations.length,
    charging:  stations.filter(s => stationHas(s, 'charging')).length,
    available: stations.filter(s => stationHas(s, 'ready')).length,
    fault:     stations.filter(s => stationHas(s, 'fault')).length,
    noData:    stations.filter(s => stationHas(s, 'offline', 'unknown')).length,
  };
}

/** Power being delivered by a station's charging heads. */
export function stationKw(s: ChargingStation): number {
  return s.heads.reduce((t, h) => t + (classifyState(h.state) === 'charging' ? h.powerKw : 0), 0);
}
