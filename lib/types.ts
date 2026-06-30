export type StationStatus = 'online' | 'degraded' | 'offline';

// ── Station Config ─────────────────────────────────────────────────────────────
export interface MqttTopics {
  heartbeat:    string;  // {"heartbeat":1,"timestamp":"..."}
  heartbeatPi5: string;  // {"heartbeatPI5":1,"timestamp":"..."}
  router:       string;  // full router status payload
  meter:        string;  // {"meter1":131734760,"meter2":119364060,...}
  powerModule:  string;  // Phoenix only — {"PM1":"2","Voltage1":...} / {"PM2":"3",...}
  faultStatus:  string;  // Phoenix only — fault status script heartbeat
  statePlc:     string;  // Phoenix only — plc state script heartbeat
  fanRPM:       string;  // Phoenix only — {"FAN 1":5397.99,...,"FAN 8":5503.99}
  plc:          string;  // Phoenix only — full PLC data payload
  vectorState?: string;  // Vector only — combined state topic (connectors, power_module, temps, isolation, contactor)
}

export interface MongoCollections {
  powerModule:          string;
  meter:                string;
  heartbeatFallingEdge: string;
  router:               string;
  statePlc:             string;   // collection in StatePLC database
}

export interface TelegramConfig {
  chatId:   string;
  botToken: string;
  enabled:  boolean;
}

export type FanBrand = 'EBM' | 'Winstrom' | 'DAKO' | string;
// HMI brand decides whether HMI_status from the PLC payload is meaningful.
// DWIN displays don't actually report active/inactive so we treat the value
// as "N/A" and skip it from the danger / problems detection.
export type HmiBrand = 'Phoenix' | 'DWIN';

// Controller hardware decides which MQTT pipeline the backend uses.
//   - phoenix: legacy — separate plc / powerModule / fanRPM / faultStatus topics
//   - vector:  one consolidated `vectorState` topic carries PLC + PowerModule +
//              isolation + cable temps + contactor + emergency.
// The Vector handler maps payload fields into the same `_plc_data` / `_pm_data`
// caches so all existing dashboards keep working.
export type ControllerType = 'phoenix' | 'vector';

export interface Station {
  id:               string;
  name:             string;      // internal name for backend communication (also MongoDB collection name)
  displayName:      string;      // name shown on dashboard UI
  location:         string;
  lat?:             number;      // map latitude (decimal degrees) — optional; falls back to location lookup
  lng?:             number;      // map longitude (decimal degrees)
  chargerHeads:     number;
  expectedPmPerHead: number;     // DEPRECATED — kept for backwards compatibility (use head1/head2 below)
  expectedPmHead1:  number;      // expected PM count for charger head 1
  expectedPmHead2:  number;      // expected PM count for charger head 2
  hasPi5?:          boolean;     // station has Pi5 device — default true (treat undefined as true)
  fanBrand:         FanBrand;    // fan manufacturer: EBM, Winstrom, DAKO
  hmiBrand?:        HmiBrand;    // HMI display: Phoenix (reports status) | DWIN (treat as N/A) — default Phoenix
  controllerType?:  ControllerType;  // 'phoenix' (default) or 'vector' — picks the MQTT ingestion pipeline
  mqttTopics:       MqttTopics;
  mongoCollections: MongoCollections;
  telegram:         TelegramConfig;
  createdAt:        string;
}

// ── Heartbeat ──────────────────────────────────────────────────────────────────
export interface HeartbeatDevice {
  name:       string;
  key:        'heartbeat' | 'heartbeatPi5' | 'router';
  topic:      string;
  lastSeen:   string;
  online:     boolean;
  connstate?: string;  // only for router: "Connected" | "Disconnected"
}

// ── Router ─────────────────────────────────────────────────────────────────────
// Full snapshot from router MQTT topic
export interface RouterData {
  connstate:  string;    // "Connected" | "Disconnected"
  tempRaw:    number;    // raw value e.g. 800 → 80.0°C (÷10)
  rssi:       number;    // dBm
  rsrp:       number;    // dBm
  rsrq:       number;    // dB
  sinr:       number;
  conntype:   string;    // "LTE", "3G", etc.
  operator:   string;
  opernum:    number;
  ip:         string[];
  model:      string;
  manuf:      string;
  imei:       string;
  iccid:      string;
  lastSeen:   string;
  online:     boolean;
}

// ── Power Module ───────────────────────────────────────────────────────────────
// Mirrors real MQTT: PM1/PM2 = count of active power modules per head
export interface PowerModuleHead {
  head:        number;   // 1 or 2
  pmCount:     number;   // PM1 or PM2 — number of active modules
  voltage:     number;   // V
  current:     number;   // A
  powerKw:     number;   // kW (computed from MQTT Power field / 1000)
  prevVoltage: number;
  prevCurrent: number;
  timestamp:   string;   // timestamp per head
  online:      boolean;  // received recently?
}

// ── Meter ──────────────────────────────────────────────────────────────────────
// One snapshot = both meters at one point in time
// Raw values are in Wh; display as kWh (÷1000)
export const METER_MAX_KWH = 171_000;  // display max

export interface MeterSnapshot {
  meter1Wh:   number;   // raw Wh — divide by 1000 for kWh display
  meter2Wh:   number;
  timestamp1: string;   // per-meter update timestamp
  timestamp2: string;
  timestamp:  string;   // record timestamp
}

// ── Temperature history (router temp chart) ────────────────────────────────────
export interface TempReading {
  timestamp: string;
  value:     number;  // °C (already converted from raw ÷10)
}

// ── Fan RPM ────────────────────────────────────────────────────────────────────
// Mirrors real MQTT: {"FAN 1": 5397.99, ..., "FAN 6": 0, ...}
export interface FanSnapshot {
  fans:      Record<string, number>;  // key = "FAN 1" … "FAN 8"
  timestamp: string;
}

// ── PLC ────────────────────────────────────────────────────────────────────────
export interface PlcHeadData {
  head:             number;
  chargeState:      string;   // "Charging" | "Ready" | "Fault" | ...
  iRessState:       number;   // internal resource state (includes SOC %)
  soc:              number;   // State of Charge %
  targetVoltage:    number;   // V
  targetCurrent:    number;   // A
  presentVoltage:   number;   // V
  presentCurrent:   number;   // A
  powerKw:          number;   // kW
  measuredVoltage:  number;   // V
  measuredCurrent:  number;   // A
  temp1Head:        number;   // °C — top temp sensor
  temp2Head:        number;   // °C — bottom temp sensor
  tempPowerModule:  number;   // °C — PM temp
  fanStatus:        number;   // 0 | 1
  headError:        number;   // 0 = no error
  errorMessage:     string;
  cpStatus:         number;   // CP status code
  activeMld:        number;
  insulationFault:  number;
  warningInsulation:number;
  maxPower:         number;   // W
  maxCurrent:       number;   // A
  maxVoltage:       number;   // V
  icp:              number;
  usl:              number;
  dynamicMaxCurrent:number;
}

export interface PlcData {
  head1:          PlcHeadData;
  head2:          PlcHeadData;
  ambientTemp:    number;   // °C
  ambientHum:     number;   // %
  ambientPressure:number;   // hPa
  pi5Temp:        number;   // °C
  hmiStatus:      string;   // "Active" | "Inactive"
  plc1Status:     string;
  plc2Status:     string;
  lem1Status:     string;
  lem2Status:     string;
  fanStatus1_8:   string;   // "1" | "0"
  timestamp:      string;
}

// ── MQTT Scripts ───────────────────────────────────────────────────────────────
export interface MqttScript {
  name:             string;
  description:      string;
  mqttTopic:        string;
  lastHeartbeat:    string;
  online:           boolean;
  expectedInterval: number;  // seconds
}

// ── Alerts ─────────────────────────────────────────────────────────────────────
export interface Alert {
  id:           string;
  stationId:    string;
  stationName:  string;
  type:         'heartbeat' | 'temperature' | 'meter' | 'power' | 'fan' | 'script' | 'plc';
  severity:     'warning' | 'critical';
  message:      string;
  timestamp:    string;
  acknowledged: boolean;
}

// ── Persistent meter status (from Station DB _meter_latest) ───────────────
// The backend updates `meterNChangedAt` only when the meter value actually
// changes, so this survives backend restarts and lets the frontend show the
// real "last increase" timestamp instead of the latest received MQTT msg.
export interface MeterLive {
  meter1: number;
  meter2: number;
  timestamp1: string;
  timestamp2: string;
  timestamp:  string;
  meter1ChangedAt: string | null;
  meter2ChangedAt: string | null;
  updatedAt: string | null;
}

// ── Station dashboard data (all panels combined) ───────────────────────────────
export interface StationDashboardData {
  stationId:         string;
  heartbeats:        HeartbeatDevice[];   // 3 devices: main, pi5, router
  routerData:        RouterData;          // full router payload (temp, signal)
  powerModuleHeads:  PowerModuleHead[];   // one entry per charger head
  meterHistory:      MeterSnapshot[];     // newest last (for charts + LED)
  meterLive:         MeterLive | null;    // persistent latest + lastChangedAt timestamps
  tempHistory:       TempReading[];       // router temp history for chart
  fanData:           FanSnapshot;         // latest 8-fan snapshot
  scripts:           MqttScript[];
  plcData:           PlcData;
}
