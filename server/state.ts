/**
 * In-memory state for all stations.
 * The backend populates this from MQTT; the WS server broadcasts changes.
 */

export interface DeviceState {
  online:   boolean;
  lastSeen: number;   // epoch ms
  payload:  unknown;  // last raw MQTT payload
}

export interface HeadChargeState {
  chargeState: string;
  powerKw:     number;
  soc:         number;
}

export interface StationState {
  // Heartbeats
  heartbeat:    DeviceState;
  heartbeatPi5: DeviceState;
  router:       DeviceState;

  // Data payloads (latest)
  meter:        unknown | null;
  powerModule:  unknown | null;
  fanRpm:       unknown | null;
  plc:          unknown | null;

  // Charge state (derived from PLC)
  chargeHead1:  HeadChargeState;
  chargeHead2:  HeadChargeState;

  // Script heartbeats
  faultStatusHb: DeviceState;
  plcScriptHb:   DeviceState;  // timeout counted from PLC topic
}

const OFF: DeviceState = { online: false, lastSeen: 0, payload: null };
const NO_CHARGE: HeadChargeState = { chargeState: 'Unknown', powerKw: 0, soc: 0 };

function emptyStation(): StationState {
  return {
    heartbeat:     { ...OFF },
    heartbeatPi5:  { ...OFF },
    router:        { ...OFF },
    meter:         null,
    powerModule:   null,
    fanRpm:        null,
    plc:           null,
    chargeHead1:   { ...NO_CHARGE },
    chargeHead2:   { ...NO_CHARGE },
    faultStatusHb: { ...OFF },
    plcScriptHb:   { ...OFF },
  };
}

/** stationId → StationState */
const state = new Map<string, StationState>();

export function getState(stationId: string): StationState {
  let s = state.get(stationId);
  if (!s) {
    s = emptyStation();
    state.set(stationId, s);
  }
  return s;
}

export function getAllState(): Map<string, StationState> {
  return state;
}
