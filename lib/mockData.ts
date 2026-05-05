import {
  Station, StationDashboardData, Alert,
  MeterSnapshot, TempReading, PlcHeadData,
  METER_MAX_KWH,
} from './types';

// ── Stable time helpers (fixed reference → SSR-safe) ──────────────────────────
const REF = new Date('2026-04-07T16:30:00.000Z').getTime();
const m   = (n: number) => new Date(REF - n * 60_000).toISOString();
const h   = (n: number) => new Date(REF - n * 3_600_000).toISOString();
const d   = (n: number) => new Date(REF - n * 86_400_000).toISOString();

// ── Seeded pseudo-random ──────────────────────────────────────────────────────
function sr(s: number) { const x = Math.sin(s + 1) * 10000; return x - Math.floor(x); }

// ── Meter history helpers ─────────────────────────────────────────────────────
// Generate 48 hourly snapshots. stopAfter = 0 means always active.
function genMeterHistory(seed: number, base1: number, base2: number, stopAfterHours = 0): MeterSnapshot[] {
  let v1 = base1, v2 = base2;
  return Array.from({ length: 48 }, (_, i) => {
    const hoursAgo = 47 - i;
    const active1  = stopAfterHours === 0 || hoursAgo < stopAfterHours;
    const active2  = stopAfterHours === 0 || hoursAgo < stopAfterHours;
    if (active1) v1 += Math.round(sr(seed * 100 + i * 2)     * 3_000 + 500);
    if (active2) v2 += Math.round(sr(seed * 100 + i * 2 + 1) * 2_800 + 400);
    return {
      meter1Wh:   v1,
      meter2Wh:   v2,
      timestamp1: h(hoursAgo),
      timestamp2: h(hoursAgo),
      timestamp:  h(hoursAgo),
    };
  });
}

// ── Router temp history (48 × 30 min = 24 h) ─────────────────────────────────
function genTempHistory(seed: number, baseTemp: number): TempReading[] {
  return Array.from({ length: 48 }, (_, i) => ({
    timestamp: new Date(REF - (47 - i) * 1_800_000).toISOString(),
    value: Math.round((baseTemp + (sr(seed * 50 + i) - 0.5) * 8) * 10) / 10,
  }));
}

// ── Mock PLC head ─────────────────────────────────────────────────────────────
function mockPlcHead(head: number, charging: boolean, seed = 1): PlcHeadData {
  return {
    head,
    chargeState:       charging ? 'Charging' : 'Ready',
    iRessState:        charging ? 73 : 0,
    soc:               charging ? 73 : 0,
    targetVoltage:     charging ? 380.2 : 0,
    targetCurrent:     charging ? 121   : 0,
    presentVoltage:    charging ? 360   : 0,
    presentCurrent:    charging ? 121   : 0,
    powerKw:           charging ? 43    : 0,
    measuredVoltage:   charging ? 359.7 : 0,
    measuredCurrent:   charging ? 120.976 : 0,
    temp1Head:         charging ? 53 : 49,
    temp2Head:         charging ? 63 : 49,
    tempPowerModule:   charging ? 35 : 41,
    fanStatus:         1,
    headError:         0,
    errorMessage:      '',
    cpStatus:          charging ? 7 : 2,
    activeMld:         charging ? 2 : 3,
    insulationFault:   0,
    warningInsulation: 0,
    maxPower:          charging ? 60_000 : 90_000,
    maxCurrent:        500,
    maxVoltage:        1000,
    icp:               charging ? 7 : 2,
    usl:               charging ? 13 : 0,
    dynamicMaxCurrent: charging ? 121 : 0,
  };
}

// ── Station factory helpers ───────────────────────────────────────────────────
function mkStation(
  id: string, location: string, chatId: string, token: string,
  telegramEnabled: boolean, createdAt: string,
  expectedPmPerHead = 3,
  fanBrand: string = 'EBM',
  displayName?: string,
): Station {
  const code = id.replace('-', '');
  return {
    id, name: id, displayName: displayName ?? id, location, chargerHeads: 2,
    expectedPmPerHead, expectedPmHead1: expectedPmPerHead, expectedPmHead2: expectedPmPerHead,
    fanBrand,
    mqttTopics: {
      heartbeat:    `ev/${code}/heartbeat`,
      heartbeatPi5: `ev/${code}/heartbeatPI5`,
      router:       `ev/${code}/router/status`,
      meter:        `ev/${code}/meter/data`,
      powerModule:  `ev/${code}/pm/data`,
      faultStatus:  `ev/${code}/script/fault_hb`,
      statePlc:     `ev/${code}/script/plc_hb`,
      fanRPM:       `ev/${code}/fan/rpm`,
      plc:          `ev/${code}/plc/data`,
    },
    mongoCollections: {
      powerModule:          `${code}_powermodule`,
      meter:                `${code}_meter`,
      heartbeatFallingEdge: `${code}_hb_falling`,
      router:               `${code}_router`,
      statePlc:             code,
    },
    telegram: { chatId, botToken: token, enabled: telegramEnabled },
    createdAt,
  };
}

// ── Stations ──────────────────────────────────────────────────────────────────
export const MOCK_STATIONS: Station[] = [
  mkStation('BKK-001', 'Bangkok – Central Plaza Ladprao',           '-100123456789', 'mock-token-bkk001', true,  '2025-11-01T00:00:00.000Z'),
  mkStation('BKK-002', 'Bangkok – Future Park Rangsit',             '-100987654321', 'mock-token-bkk002', true,  '2025-11-15T00:00:00.000Z', 2),
  mkStation('BKK-003', 'Bangkok – Mega Bangna',                     '-100222333444', 'mock-token-bkk003', true,  '2025-12-01T00:00:00.000Z'),
  mkStation('BKK-004', 'Bangkok – Seacon Square Srinakarin',        '-100333444555', 'mock-token-bkk004', true,  '2025-12-15T00:00:00.000Z'),
  mkStation('CNX-001', 'Chiang Mai – Maya Lifestyle Shopping Center','-100111222333', 'mock-token-cnx001', false, '2025-12-01T00:00:00.000Z'),
  mkStation('CNX-002', 'Chiang Mai – Central Festival Chiang Mai',  '-100444555666', 'mock-token-cnx002', true,  '2026-01-05T00:00:00.000Z'),
  mkStation('PKT-001', 'Phuket – Central Floresta Phuket',          '-100555666777', 'mock-token-pkt001', true,  '2026-01-10T00:00:00.000Z'),
  mkStation('PTY-001', 'Pattaya – Terminal 21 Pattaya',             '-100666777888', 'mock-token-pty001', false, '2026-01-20T00:00:00.000Z'),
  mkStation('KKN-001', 'Khon Kaen – Central Plaza Khon Kaen',       '-100777888999', 'mock-token-kkn001', true,  '2026-02-01T00:00:00.000Z'),
  mkStation('HYI-001', 'Hat Yai – Lee Gardens Plaza',               '-100888999000', 'mock-token-hyi001', true,  '2026-02-10T00:00:00.000Z'),
  mkStation('UDN-001', 'Udon Thani – Central Plaza Udon Thani',     '-100999000111', 'mock-token-udn001', true,  '2026-02-20T00:00:00.000Z', 2),
  mkStation('NST-001', 'Nakhon Si Thammarat – Central Nakhon Si',   '-100000111222', 'mock-token-nst001', false, '2026-03-01T00:00:00.000Z', 2),
  mkStation('RYG-001', 'Rayong – Lotus\'s Extra Rayong',            '-100111000333', 'mock-token-ryg001', true,  '2026-03-10T00:00:00.000Z'),
];

// ── Dashboard data ────────────────────────────────────────────────────────────
export const MOCK_DASHBOARD: Record<string, StationDashboardData> = {

  // ── BKK-001 · Online, both heads charging ─────────────────────────────────
  'BKK-001': {
    stationId: 'BKK-001',
    heartbeats: [
      { name: 'OCPP Device', key: 'heartbeat',    topic: 'ev/BKK001/heartbeat',     lastSeen: m(2),  online: true,  connstate: undefined },
      { name: 'Pi5',  key: 'heartbeatPi5', topic: 'ev/BKK001/heartbeatPI5',  lastSeen: m(1),  online: true,  connstate: undefined },
      { name: 'Router',  key: 'router',       topic: 'ev/BKK001/router/status', lastSeen: m(3),  online: true,  connstate: 'Connected' },
    ],
    routerData: {
      connstate: 'Connected', tempRaw: 800,
      rssi: -37, rsrp: -71, rsrq: -15, sinr: 2,
      conntype: 'LTE', operator: 'AIS', opernum: 52001,
      ip: ['10.76.174.17'], model: 'EC25-EU', manuf: 'Quectel',
      imei: '864303053072669', iccid: '8966032410021328254F',
      lastSeen: m(3), online: true,
    },
    powerModuleHeads: [
      { head: 1, pmCount: 2, voltage: 418.2, current: 127, powerKw: 53.11, prevVoltage: 408, prevCurrent: 127, timestamp: m(5),  online: true },
      { head: 2, pmCount: 3, voltage: 419.4, current: 41,  powerKw: 17.20, prevVoltage: 408, prevCurrent: 41,  timestamp: m(3),  online: true },
    ],
    meterHistory: genMeterHistory(1, 100_264_730, 106_600_170),
    tempHistory:  genTempHistory(1, 80.0),
    fanData: {
      fans: {
        'FAN 1': 5397.99, 'FAN 2': 5289.32, 'FAN 3': 5384.66,
        'FAN 4': 5473.32, 'FAN 5': 5382.66, 'FAN 6': 0,
        'FAN 7': 5411.99, 'FAN 8': 5503.99,
      },
      timestamp: m(1),
    },
    scripts: [
      { name: 'meter_reader',  description: 'RS485 meter → MQTT bridge',     mqttTopic: 'ev/BKK001/script/meter_hb',  lastHeartbeat: m(4),  online: true,  expectedInterval: 60 },
      { name: 'fault_status',  description: 'Fault status heartbeat monitor', mqttTopic: 'ev/BKK001/script/fault_hb',  lastHeartbeat: m(2),  online: true,  expectedInterval: 30 },
      { name: 'state_plc',     description: 'PLC state heartbeat monitor',    mqttTopic: 'ev/BKK001/script/plc_hb',    lastHeartbeat: m(1),  online: true,  expectedInterval: 30 },
      { name: 'hb_sender',     description: 'Main heartbeat broadcaster',     mqttTopic: 'ev/BKK001/script/hb_send',   lastHeartbeat: m(1),  online: true,  expectedInterval: 60 },
      { name: 'plc_bridge',    description: 'Modbus TCP ↔ MQTT bridge',        mqttTopic: 'ev/BKK001/script/plc_bridge',lastHeartbeat: m(3),  online: true,  expectedInterval: 30 },
      { name: 'fan_monitor',   description: 'EBM fan RPM sampler',            mqttTopic: 'ev/BKK001/script/fan_hb',    lastHeartbeat: h(1),  online: false, expectedInterval: 30 },
    ],
    plcData: {
      head1: mockPlcHead(1, true),
      head2: mockPlcHead(2, false),
      ambientTemp: 42.65, ambientHum: 21.75, ambientPressure: 1006.72,
      pi5Temp: 52.9,
      hmiStatus: 'Active', plc1Status: 'Active', plc2Status: 'Active',
      lem1Status: 'Active', lem2Status: 'Active',
      fanStatus1_8: '1', timestamp: m(2),
    },
  },

  // ── BKK-002 · Degraded: Pi5 offline, meter2 stalled, temp high ───────────
  'BKK-002': {
    stationId: 'BKK-002',
    heartbeats: [
      { name: 'OCPP Device', key: 'heartbeat',    topic: 'ev/BKK002/heartbeat',     lastSeen: m(3),   online: true,  connstate: undefined },
      { name: 'Pi5',  key: 'heartbeatPi5', topic: 'ev/BKK002/heartbeatPI5',  lastSeen: h(2),   online: false, connstate: undefined },
      { name: 'Router',  key: 'router',       topic: 'ev/BKK002/router/status', lastSeen: m(5),   online: true,  connstate: 'Connected' },
    ],
    routerData: {
      connstate: 'Connected', tempRaw: 790,
      rssi: -62, rsrp: -95, rsrq: -18, sinr: -1,
      conntype: 'LTE', operator: 'DTAC', opernum: 52005,
      ip: ['10.88.21.43'], model: 'EC25-EU', manuf: 'Quectel',
      imei: '864303053099001', iccid: '8966032310011234512F',
      lastSeen: m(5), online: true,
    },
    powerModuleHeads: [
      { head: 1, pmCount: 1, voltage: 408.0, current: 11,  powerKw: 4.49, prevVoltage: 402, prevCurrent: 10, timestamp: m(8),  online: true  },
      { head: 2, pmCount: 0, voltage: 0,     current: 0,   powerKw: 0,    prevVoltage: 0,   prevCurrent: 0,  timestamp: h(3),  online: false },
    ],
    // meter2 stopped 3 days ago
    meterHistory: genMeterHistory(2, 80_000_000, 95_000_000, 72),
    tempHistory:  genTempHistory(2, 79.0),
    fanData: {
      fans: {
        'FAN 1': 5100.0, 'FAN 2': 5050.5, 'FAN 3': 5200.1,
        'FAN 4': 5150.8, 'FAN 5': 5180.3, 'FAN 6': 5080.0,
        'FAN 7': 5210.9, 'FAN 8': 5090.2,
      },
      timestamp: m(2),
    },
    scripts: [
      { name: 'meter_reader',  description: 'RS485 meter → MQTT bridge',     mqttTopic: 'ev/BKK002/script/meter_hb',   lastHeartbeat: h(4),  online: false, expectedInterval: 60 },
      { name: 'fault_status',  description: 'Fault status heartbeat monitor', mqttTopic: 'ev/BKK002/script/fault_hb',   lastHeartbeat: m(4),  online: true,  expectedInterval: 30 },
      { name: 'state_plc',     description: 'PLC state heartbeat monitor',    mqttTopic: 'ev/BKK002/script/plc_hb',     lastHeartbeat: h(6),  online: false, expectedInterval: 30 },
      { name: 'hb_sender',     description: 'Main heartbeat broadcaster',     mqttTopic: 'ev/BKK002/script/hb_send',    lastHeartbeat: m(2),  online: true,  expectedInterval: 60 },
      { name: 'plc_bridge',    description: 'Modbus TCP ↔ MQTT bridge',        mqttTopic: 'ev/BKK002/script/plc_bridge', lastHeartbeat: m(5),  online: true,  expectedInterval: 30 },
    ],
    plcData: {
      head1: mockPlcHead(1, true, 2),
      head2: { ...mockPlcHead(2, false, 2), chargeState: 'Fault', headError: 1, errorMessage: 'E05 Insulation fault' },
      ambientTemp: 45.2, ambientHum: 28.1, ambientPressure: 1004.1,
      pi5Temp: 58.3,
      hmiStatus: 'Active', plc1Status: 'Active', plc2Status: 'Inactive',
      lem1Status: 'Active', lem2Status: 'Inactive',
      fanStatus1_8: '1', timestamp: h(1),
    },
  },

  // ── CNX-001 · Fully offline ────────────────────────────────────────────────
  'CNX-001': {
    stationId: 'CNX-001',
    heartbeats: [
      { name: 'OCPP Device', key: 'heartbeat',    topic: 'ev/CNX001/heartbeat',     lastSeen: h(5),  online: false, connstate: undefined },
      { name: 'Pi5',  key: 'heartbeatPi5', topic: 'ev/CNX001/heartbeatPI5',  lastSeen: h(6),  online: false, connstate: undefined },
      { name: 'Router',  key: 'router',       topic: 'ev/CNX001/router/status', lastSeen: h(7),  online: false, connstate: 'Disconnected' },
    ],
    routerData: {
      connstate: 'Disconnected', tempRaw: 0,
      rssi: 0, rsrp: 0, rsrq: 0, sinr: 0,
      conntype: '—', operator: '—', opernum: 0,
      ip: [], model: 'EC25-EU', manuf: 'Quectel',
      imei: '864303053011111', iccid: '8966032310011111111F',
      lastSeen: h(7), online: false,
    },
    powerModuleHeads: [
      { head: 1, pmCount: 0, voltage: 0, current: 0, powerKw: 0, prevVoltage: 0, prevCurrent: 0, timestamp: h(7), online: false },
      { head: 2, pmCount: 0, voltage: 0, current: 0, powerKw: 0, prevVoltage: 0, prevCurrent: 0, timestamp: h(7), online: false },
    ],
    meterHistory: genMeterHistory(3, 50_000_000, 60_000_000, 200),
    tempHistory:  genTempHistory(3, 35.0),
    fanData: {
      fans: {
        'FAN 1': 0, 'FAN 2': 0, 'FAN 3': 0, 'FAN 4': 0,
        'FAN 5': 0, 'FAN 6': 0, 'FAN 7': 0, 'FAN 8': 0,
      },
      timestamp: h(7),
    },
    scripts: [
      { name: 'meter_reader',  description: 'RS485 meter → MQTT bridge',     mqttTopic: 'ev/CNX001/script/meter_hb',  lastHeartbeat: h(7), online: false, expectedInterval: 60 },
      { name: 'fault_status',  description: 'Fault status heartbeat monitor', mqttTopic: 'ev/CNX001/script/fault_hb',  lastHeartbeat: h(7), online: false, expectedInterval: 30 },
      { name: 'state_plc',     description: 'PLC state heartbeat monitor',    mqttTopic: 'ev/CNX001/script/plc_hb',    lastHeartbeat: h(7), online: false, expectedInterval: 30 },
      { name: 'hb_sender',     description: 'Main heartbeat broadcaster',     mqttTopic: 'ev/CNX001/script/hb_send',   lastHeartbeat: h(7), online: false, expectedInterval: 60 },
    ],
    plcData: {
      head1: { ...mockPlcHead(1, false), chargeState: 'Offline' },
      head2: { ...mockPlcHead(2, false), chargeState: 'Offline' },
      ambientTemp: 0, ambientHum: 0, ambientPressure: 0,
      pi5Temp: 0,
      hmiStatus: 'Inactive', plc1Status: 'Inactive', plc2Status: 'Inactive',
      lem1Status: 'Inactive', lem2Status: 'Inactive',
      fanStatus1_8: '0', timestamp: h(7),
    },
  },

  // ── BKK-003 · Online, both heads full ────────────────────────────────────────
  'BKK-003': {
    stationId: 'BKK-003',
    heartbeats: [
      { name: 'OCPP Device', key: 'heartbeat',    topic: 'ev/BKK003/heartbeat',     lastSeen: m(1),  online: true,  connstate: undefined },
      { name: 'Pi5',  key: 'heartbeatPi5', topic: 'ev/BKK003/heartbeatPI5',  lastSeen: m(2),  online: true,  connstate: undefined },
      { name: 'Router',  key: 'router',       topic: 'ev/BKK003/router/status', lastSeen: m(1),  online: true,  connstate: 'Connected' },
    ],
    routerData: {
      connstate: 'Connected', tempRaw: 750,
      rssi: -45, rsrp: -78, rsrq: -12, sinr: 5,
      conntype: 'LTE', operator: 'TRUE', opernum: 52004,
      ip: ['10.55.32.101'], model: 'EC25-EU', manuf: 'Quectel',
      imei: '864303053081234', iccid: '8966032410021399001F',
      lastSeen: m(1), online: true,
    },
    powerModuleHeads: [
      { head: 1, pmCount: 3, voltage: 420.1, current: 140, powerKw: 58.8, prevVoltage: 415, prevCurrent: 138, timestamp: m(3), online: true },
      { head: 2, pmCount: 3, voltage: 418.5, current: 135, powerKw: 56.5, prevVoltage: 412, prevCurrent: 130, timestamp: m(2), online: true },
    ],
    meterHistory: genMeterHistory(4, 120_000_000, 118_000_000),
    tempHistory:  genTempHistory(4, 75.0),
    fanData: {
      fans: { 'FAN 1': 5420, 'FAN 2': 5390, 'FAN 3': 5410, 'FAN 4': 5430, 'FAN 5': 5400, 'FAN 6': 5380, 'FAN 7': 5450, 'FAN 8': 5370 },
      timestamp: m(1),
    },
    scripts: [
      { name: 'meter_reader', description: 'RS485 meter → MQTT bridge',      mqttTopic: 'ev/BKK003/script/meter_hb',   lastHeartbeat: m(3),  online: true,  expectedInterval: 60 },
      { name: 'fault_status', description: 'Fault status heartbeat monitor',  mqttTopic: 'ev/BKK003/script/fault_hb',   lastHeartbeat: m(1),  online: true,  expectedInterval: 30 },
      { name: 'state_plc',    description: 'PLC state heartbeat monitor',     mqttTopic: 'ev/BKK003/script/plc_hb',     lastHeartbeat: m(2),  online: true,  expectedInterval: 30 },
      { name: 'hb_sender',    description: 'Main heartbeat broadcaster',      mqttTopic: 'ev/BKK003/script/hb_send',    lastHeartbeat: m(1),  online: true,  expectedInterval: 60 },
      { name: 'plc_bridge',   description: 'Modbus TCP ↔ MQTT bridge',        mqttTopic: 'ev/BKK003/script/plc_bridge', lastHeartbeat: m(2),  online: true,  expectedInterval: 30 },
      { name: 'fan_monitor',  description: 'EBM fan RPM sampler',             mqttTopic: 'ev/BKK003/script/fan_hb',     lastHeartbeat: m(1),  online: true,  expectedInterval: 30 },
    ],
    plcData: {
      head1: mockPlcHead(1, true, 4),
      head2: mockPlcHead(2, true, 4),
      ambientTemp: 40.1, ambientHum: 19.5, ambientPressure: 1008.0,
      pi5Temp: 50.2,
      hmiStatus: 'Active', plc1Status: 'Active', plc2Status: 'Active',
      lem1Status: 'Active', lem2Status: 'Active',
      fanStatus1_8: '1', timestamp: m(1),
    },
  },

  // ── BKK-004 · Degraded: router temp high, fan fault ──────────────────────────
  'BKK-004': {
    stationId: 'BKK-004',
    heartbeats: [
      { name: 'OCPP Device', key: 'heartbeat',    topic: 'ev/BKK004/heartbeat',     lastSeen: m(4),  online: true,  connstate: undefined },
      { name: 'Pi5',  key: 'heartbeatPi5', topic: 'ev/BKK004/heartbeatPI5',  lastSeen: m(3),  online: true,  connstate: undefined },
      { name: 'Router',  key: 'router',       topic: 'ev/BKK004/router/status', lastSeen: m(6),  online: true,  connstate: 'Connected' },
    ],
    routerData: {
      connstate: 'Connected', tempRaw: 840,
      rssi: -70, rsrp: -102, rsrq: -20, sinr: -3,
      conntype: 'LTE', operator: 'AIS', opernum: 52001,
      ip: ['10.76.55.202'], model: 'EC25-EU', manuf: 'Quectel',
      imei: '864303053082222', iccid: '8966032410021400002F',
      lastSeen: m(6), online: true,
    },
    powerModuleHeads: [
      { head: 1, pmCount: 2, voltage: 415.0, current: 120, powerKw: 49.8, prevVoltage: 410, prevCurrent: 118, timestamp: m(7), online: true },
      { head: 2, pmCount: 2, voltage: 416.0, current: 122, powerKw: 50.8, prevVoltage: 412, prevCurrent: 120, timestamp: m(5), online: true },
    ],
    meterHistory: genMeterHistory(5, 88_000_000, 92_000_000),
    tempHistory:  genTempHistory(5, 84.0),
    fanData: {
      fans: { 'FAN 1': 5300, 'FAN 2': 5280, 'FAN 3': 0, 'FAN 4': 5320, 'FAN 5': 5290, 'FAN 6': 5310, 'FAN 7': 0, 'FAN 8': 5270 },
      timestamp: m(3),
    },
    scripts: [
      { name: 'meter_reader', description: 'RS485 meter → MQTT bridge',      mqttTopic: 'ev/BKK004/script/meter_hb',   lastHeartbeat: m(5),  online: true,  expectedInterval: 60 },
      { name: 'fault_status', description: 'Fault status heartbeat monitor',  mqttTopic: 'ev/BKK004/script/fault_hb',   lastHeartbeat: m(3),  online: true,  expectedInterval: 30 },
      { name: 'state_plc',    description: 'PLC state heartbeat monitor',     mqttTopic: 'ev/BKK004/script/plc_hb',     lastHeartbeat: h(2),  online: false, expectedInterval: 30 },
      { name: 'hb_sender',    description: 'Main heartbeat broadcaster',      mqttTopic: 'ev/BKK004/script/hb_send',    lastHeartbeat: m(2),  online: true,  expectedInterval: 60 },
      { name: 'plc_bridge',   description: 'Modbus TCP ↔ MQTT bridge',        mqttTopic: 'ev/BKK004/script/plc_bridge', lastHeartbeat: m(4),  online: true,  expectedInterval: 30 },
    ],
    plcData: {
      head1: mockPlcHead(1, true, 5),
      head2: mockPlcHead(2, true, 5),
      ambientTemp: 47.3, ambientHum: 32.0, ambientPressure: 1003.5,
      pi5Temp: 61.0,
      hmiStatus: 'Active', plc1Status: 'Active', plc2Status: 'Active',
      lem1Status: 'Active', lem2Status: 'Active',
      fanStatus1_8: '1', timestamp: m(3),
    },
  },

  // ── CNX-002 · Online ──────────────────────────────────────────────────────────
  'CNX-002': {
    stationId: 'CNX-002',
    heartbeats: [
      { name: 'OCPP Device', key: 'heartbeat',    topic: 'ev/CNX002/heartbeat',     lastSeen: m(2),  online: true,  connstate: undefined },
      { name: 'Pi5',  key: 'heartbeatPi5', topic: 'ev/CNX002/heartbeatPI5',  lastSeen: m(1),  online: true,  connstate: undefined },
      { name: 'Router',  key: 'router',       topic: 'ev/CNX002/router/status', lastSeen: m(3),  online: true,  connstate: 'Connected' },
    ],
    routerData: {
      connstate: 'Connected', tempRaw: 720,
      rssi: -52, rsrp: -83, rsrq: -14, sinr: 3,
      conntype: 'LTE', operator: 'DTAC', opernum: 52005,
      ip: ['10.88.44.77'], model: 'EC25-EU', manuf: 'Quectel',
      imei: '864303053083333', iccid: '8966032310011500003F',
      lastSeen: m(3), online: true,
    },
    powerModuleHeads: [
      { head: 1, pmCount: 3, voltage: 417.8, current: 133, powerKw: 55.6, prevVoltage: 413, prevCurrent: 130, timestamp: m(4), online: true },
      { head: 2, pmCount: 2, voltage: 413.0, current: 88,  powerKw: 36.3, prevVoltage: 410, prevCurrent: 85,  timestamp: m(2), online: true },
    ],
    meterHistory: genMeterHistory(6, 75_000_000, 80_000_000),
    tempHistory:  genTempHistory(6, 72.0),
    fanData: {
      fans: { 'FAN 1': 5350, 'FAN 2': 5320, 'FAN 3': 5360, 'FAN 4': 5340, 'FAN 5': 5330, 'FAN 6': 5310, 'FAN 7': 5370, 'FAN 8': 5300 },
      timestamp: m(2),
    },
    scripts: [
      { name: 'meter_reader', description: 'RS485 meter → MQTT bridge',      mqttTopic: 'ev/CNX002/script/meter_hb',   lastHeartbeat: m(4),  online: true,  expectedInterval: 60 },
      { name: 'fault_status', description: 'Fault status heartbeat monitor',  mqttTopic: 'ev/CNX002/script/fault_hb',   lastHeartbeat: m(2),  online: true,  expectedInterval: 30 },
      { name: 'state_plc',    description: 'PLC state heartbeat monitor',     mqttTopic: 'ev/CNX002/script/plc_hb',     lastHeartbeat: m(1),  online: true,  expectedInterval: 30 },
      { name: 'hb_sender',    description: 'Main heartbeat broadcaster',      mqttTopic: 'ev/CNX002/script/hb_send',    lastHeartbeat: m(1),  online: true,  expectedInterval: 60 },
      { name: 'plc_bridge',   description: 'Modbus TCP ↔ MQTT bridge',        mqttTopic: 'ev/CNX002/script/plc_bridge', lastHeartbeat: m(3),  online: true,  expectedInterval: 30 },
      { name: 'fan_monitor',  description: 'EBM fan RPM sampler',             mqttTopic: 'ev/CNX002/script/fan_hb',     lastHeartbeat: m(2),  online: true,  expectedInterval: 30 },
    ],
    plcData: {
      head1: mockPlcHead(1, true, 6),
      head2: mockPlcHead(2, false, 6),
      ambientTemp: 38.4, ambientHum: 25.0, ambientPressure: 1010.2,
      pi5Temp: 48.7,
      hmiStatus: 'Active', plc1Status: 'Active', plc2Status: 'Active',
      lem1Status: 'Active', lem2Status: 'Active',
      fanStatus1_8: '1', timestamp: m(2),
    },
  },

  // ── PKT-001 · Degraded: 1 PM missing on head1, script offline ────────────────
  'PKT-001': {
    stationId: 'PKT-001',
    heartbeats: [
      { name: 'OCPP Device', key: 'heartbeat',    topic: 'ev/PKT001/heartbeat',     lastSeen: m(3),  online: true,  connstate: undefined },
      { name: 'Pi5',  key: 'heartbeatPi5', topic: 'ev/PKT001/heartbeatPI5',  lastSeen: m(4),  online: true,  connstate: undefined },
      { name: 'Router',  key: 'router',       topic: 'ev/PKT001/router/status', lastSeen: m(5),  online: true,  connstate: 'Connected' },
    ],
    routerData: {
      connstate: 'Connected', tempRaw: 760,
      rssi: -58, rsrp: -90, rsrq: -16, sinr: 1,
      conntype: 'LTE', operator: 'TRUE', opernum: 52004,
      ip: ['10.77.23.55'], model: 'EC25-EU', manuf: 'Quectel',
      imei: '864303053084444', iccid: '8966032410021600004F',
      lastSeen: m(5), online: true,
    },
    powerModuleHeads: [
      { head: 1, pmCount: 2, voltage: 412.0, current: 95,  powerKw: 39.1, prevVoltage: 408, prevCurrent: 93,  timestamp: m(6), online: true  },
      { head: 2, pmCount: 3, voltage: 419.0, current: 140, powerKw: 58.7, prevVoltage: 414, prevCurrent: 138, timestamp: m(4), online: true  },
    ],
    meterHistory: genMeterHistory(7, 60_000_000, 65_000_000),
    tempHistory:  genTempHistory(7, 76.0),
    fanData: {
      fans: { 'FAN 1': 5250, 'FAN 2': 5230, 'FAN 3': 5270, 'FAN 4': 5240, 'FAN 5': 5260, 'FAN 6': 5220, 'FAN 7': 5280, 'FAN 8': 0 },
      timestamp: m(4),
    },
    scripts: [
      { name: 'meter_reader', description: 'RS485 meter → MQTT bridge',      mqttTopic: 'ev/PKT001/script/meter_hb',   lastHeartbeat: m(5),  online: true,  expectedInterval: 60 },
      { name: 'fault_status', description: 'Fault status heartbeat monitor',  mqttTopic: 'ev/PKT001/script/fault_hb',   lastHeartbeat: m(3),  online: true,  expectedInterval: 30 },
      { name: 'state_plc',    description: 'PLC state heartbeat monitor',     mqttTopic: 'ev/PKT001/script/plc_hb',     lastHeartbeat: h(3),  online: false, expectedInterval: 30 },
      { name: 'hb_sender',    description: 'Main heartbeat broadcaster',      mqttTopic: 'ev/PKT001/script/hb_send',    lastHeartbeat: m(2),  online: true,  expectedInterval: 60 },
    ],
    plcData: {
      head1: mockPlcHead(1, false, 7),
      head2: mockPlcHead(2, true,  7),
      ambientTemp: 41.8, ambientHum: 30.5, ambientPressure: 1007.0,
      pi5Temp: 53.5,
      hmiStatus: 'Active', plc1Status: 'Inactive', plc2Status: 'Active',
      lem1Status: 'Active', lem2Status: 'Active',
      fanStatus1_8: '1', timestamp: m(4),
    },
  },

  // ── PTY-001 · Offline ─────────────────────────────────────────────────────────
  'PTY-001': {
    stationId: 'PTY-001',
    heartbeats: [
      { name: 'OCPP Device', key: 'heartbeat',    topic: 'ev/PTY001/heartbeat',     lastSeen: h(8),  online: false, connstate: undefined },
      { name: 'Pi5',  key: 'heartbeatPi5', topic: 'ev/PTY001/heartbeatPI5',  lastSeen: h(9),  online: false, connstate: undefined },
      { name: 'Router',  key: 'router',       topic: 'ev/PTY001/router/status', lastSeen: h(10), online: false, connstate: 'Disconnected' },
    ],
    routerData: {
      connstate: 'Disconnected', tempRaw: 0,
      rssi: 0, rsrp: 0, rsrq: 0, sinr: 0,
      conntype: '—', operator: '—', opernum: 0,
      ip: [], model: 'EC25-EU', manuf: 'Quectel',
      imei: '864303053085555', iccid: '8966032410021700005F',
      lastSeen: h(10), online: false,
    },
    powerModuleHeads: [
      { head: 1, pmCount: 0, voltage: 0, current: 0, powerKw: 0, prevVoltage: 0, prevCurrent: 0, timestamp: h(10), online: false },
      { head: 2, pmCount: 0, voltage: 0, current: 0, powerKw: 0, prevVoltage: 0, prevCurrent: 0, timestamp: h(10), online: false },
    ],
    meterHistory: genMeterHistory(8, 40_000_000, 45_000_000, 200),
    tempHistory:  genTempHistory(8, 30.0),
    fanData: {
      fans: { 'FAN 1': 0, 'FAN 2': 0, 'FAN 3': 0, 'FAN 4': 0, 'FAN 5': 0, 'FAN 6': 0, 'FAN 7': 0, 'FAN 8': 0 },
      timestamp: h(10),
    },
    scripts: [
      { name: 'meter_reader', description: 'RS485 meter → MQTT bridge',      mqttTopic: 'ev/PTY001/script/meter_hb', lastHeartbeat: h(10), online: false, expectedInterval: 60 },
      { name: 'fault_status', description: 'Fault status heartbeat monitor',  mqttTopic: 'ev/PTY001/script/fault_hb', lastHeartbeat: h(10), online: false, expectedInterval: 30 },
      { name: 'state_plc',    description: 'PLC state heartbeat monitor',     mqttTopic: 'ev/PTY001/script/plc_hb',   lastHeartbeat: h(10), online: false, expectedInterval: 30 },
      { name: 'hb_sender',    description: 'Main heartbeat broadcaster',      mqttTopic: 'ev/PTY001/script/hb_send',  lastHeartbeat: h(10), online: false, expectedInterval: 60 },
    ],
    plcData: {
      head1: { ...mockPlcHead(1, false), chargeState: 'Offline' },
      head2: { ...mockPlcHead(2, false), chargeState: 'Offline' },
      ambientTemp: 0, ambientHum: 0, ambientPressure: 0, pi5Temp: 0,
      hmiStatus: 'Inactive', plc1Status: 'Inactive', plc2Status: 'Inactive',
      lem1Status: 'Inactive', lem2Status: 'Inactive',
      fanStatus1_8: '0', timestamp: h(10),
    },
  },

  // ── KKN-001 · Online ──────────────────────────────────────────────────────────
  'KKN-001': {
    stationId: 'KKN-001',
    heartbeats: [
      { name: 'OCPP Device', key: 'heartbeat',    topic: 'ev/KKN001/heartbeat',     lastSeen: m(2),  online: true,  connstate: undefined },
      { name: 'Pi5',  key: 'heartbeatPi5', topic: 'ev/KKN001/heartbeatPI5',  lastSeen: m(3),  online: true,  connstate: undefined },
      { name: 'Router',  key: 'router',       topic: 'ev/KKN001/router/status', lastSeen: m(2),  online: true,  connstate: 'Connected' },
    ],
    routerData: {
      connstate: 'Connected', tempRaw: 730,
      rssi: -48, rsrp: -80, rsrq: -13, sinr: 4,
      conntype: 'LTE', operator: 'AIS', opernum: 52001,
      ip: ['10.76.88.120'], model: 'EC25-EU', manuf: 'Quectel',
      imei: '864303053086666', iccid: '8966032410021800006F',
      lastSeen: m(2), online: true,
    },
    powerModuleHeads: [
      { head: 1, pmCount: 3, voltage: 421.0, current: 145, powerKw: 61.0, prevVoltage: 416, prevCurrent: 142, timestamp: m(3), online: true },
      { head: 2, pmCount: 3, voltage: 420.5, current: 143, powerKw: 60.2, prevVoltage: 415, prevCurrent: 141, timestamp: m(2), online: true },
    ],
    meterHistory: genMeterHistory(9, 55_000_000, 58_000_000),
    tempHistory:  genTempHistory(9, 73.0),
    fanData: {
      fans: { 'FAN 1': 5500, 'FAN 2': 5480, 'FAN 3': 5510, 'FAN 4': 5490, 'FAN 5': 5470, 'FAN 6': 5520, 'FAN 7': 5460, 'FAN 8': 5530 },
      timestamp: m(1),
    },
    scripts: [
      { name: 'meter_reader', description: 'RS485 meter → MQTT bridge',      mqttTopic: 'ev/KKN001/script/meter_hb',   lastHeartbeat: m(3),  online: true,  expectedInterval: 60 },
      { name: 'fault_status', description: 'Fault status heartbeat monitor',  mqttTopic: 'ev/KKN001/script/fault_hb',   lastHeartbeat: m(1),  online: true,  expectedInterval: 30 },
      { name: 'state_plc',    description: 'PLC state heartbeat monitor',     mqttTopic: 'ev/KKN001/script/plc_hb',     lastHeartbeat: m(2),  online: true,  expectedInterval: 30 },
      { name: 'hb_sender',    description: 'Main heartbeat broadcaster',      mqttTopic: 'ev/KKN001/script/hb_send',    lastHeartbeat: m(1),  online: true,  expectedInterval: 60 },
      { name: 'plc_bridge',   description: 'Modbus TCP ↔ MQTT bridge',        mqttTopic: 'ev/KKN001/script/plc_bridge', lastHeartbeat: m(2),  online: true,  expectedInterval: 30 },
      { name: 'fan_monitor',  description: 'EBM fan RPM sampler',             mqttTopic: 'ev/KKN001/script/fan_hb',     lastHeartbeat: m(2),  online: true,  expectedInterval: 30 },
    ],
    plcData: {
      head1: mockPlcHead(1, true, 9),
      head2: mockPlcHead(2, true, 9),
      ambientTemp: 39.0, ambientHum: 22.0, ambientPressure: 1009.5,
      pi5Temp: 49.8,
      hmiStatus: 'Active', plc1Status: 'Active', plc2Status: 'Active',
      lem1Status: 'Active', lem2Status: 'Active',
      fanStatus1_8: '1', timestamp: m(1),
    },
  },

  // ── HYI-001 · Online ──────────────────────────────────────────────────────────
  'HYI-001': {
    stationId: 'HYI-001',
    heartbeats: [
      { name: 'OCPP Device', key: 'heartbeat',    topic: 'ev/HYI001/heartbeat',     lastSeen: m(1),  online: true,  connstate: undefined },
      { name: 'Pi5',  key: 'heartbeatPi5', topic: 'ev/HYI001/heartbeatPI5',  lastSeen: m(2),  online: true,  connstate: undefined },
      { name: 'Router',  key: 'router',       topic: 'ev/HYI001/router/status', lastSeen: m(3),  online: true,  connstate: 'Connected' },
    ],
    routerData: {
      connstate: 'Connected', tempRaw: 710,
      rssi: -40, rsrp: -73, rsrq: -11, sinr: 6,
      conntype: 'LTE', operator: 'TRUE', opernum: 52004,
      ip: ['10.55.99.44'], model: 'EC25-EU', manuf: 'Quectel',
      imei: '864303053087777', iccid: '8966032410021900007F',
      lastSeen: m(3), online: true,
    },
    powerModuleHeads: [
      { head: 1, pmCount: 3, voltage: 418.0, current: 130, powerKw: 54.3, prevVoltage: 413, prevCurrent: 128, timestamp: m(4), online: true },
      { head: 2, pmCount: 3, voltage: 417.5, current: 128, powerKw: 53.4, prevVoltage: 412, prevCurrent: 125, timestamp: m(3), online: true },
    ],
    meterHistory: genMeterHistory(10, 90_000_000, 95_000_000),
    tempHistory:  genTempHistory(10, 71.0),
    fanData: {
      fans: { 'FAN 1': 5440, 'FAN 2': 5420, 'FAN 3': 5460, 'FAN 4': 5410, 'FAN 5': 5450, 'FAN 6': 5430, 'FAN 7': 5470, 'FAN 8': 5400 },
      timestamp: m(2),
    },
    scripts: [
      { name: 'meter_reader', description: 'RS485 meter → MQTT bridge',      mqttTopic: 'ev/HYI001/script/meter_hb',   lastHeartbeat: m(4),  online: true,  expectedInterval: 60 },
      { name: 'fault_status', description: 'Fault status heartbeat monitor',  mqttTopic: 'ev/HYI001/script/fault_hb',   lastHeartbeat: m(2),  online: true,  expectedInterval: 30 },
      { name: 'state_plc',    description: 'PLC state heartbeat monitor',     mqttTopic: 'ev/HYI001/script/plc_hb',     lastHeartbeat: m(1),  online: true,  expectedInterval: 30 },
      { name: 'hb_sender',    description: 'Main heartbeat broadcaster',      mqttTopic: 'ev/HYI001/script/hb_send',    lastHeartbeat: m(1),  online: true,  expectedInterval: 60 },
      { name: 'plc_bridge',   description: 'Modbus TCP ↔ MQTT bridge',        mqttTopic: 'ev/HYI001/script/plc_bridge', lastHeartbeat: m(3),  online: true,  expectedInterval: 30 },
      { name: 'fan_monitor',  description: 'EBM fan RPM sampler',             mqttTopic: 'ev/HYI001/script/fan_hb',     lastHeartbeat: m(1),  online: true,  expectedInterval: 30 },
    ],
    plcData: {
      head1: mockPlcHead(1, true, 10),
      head2: mockPlcHead(2, true, 10),
      ambientTemp: 37.5, ambientHum: 18.0, ambientPressure: 1011.0,
      pi5Temp: 47.3,
      hmiStatus: 'Active', plc1Status: 'Active', plc2Status: 'Active',
      lem1Status: 'Active', lem2Status: 'Active',
      fanStatus1_8: '1', timestamp: m(2),
    },
  },

  // ── UDN-001 · Online ──────────────────────────────────────────────────────────
  'UDN-001': {
    stationId: 'UDN-001',
    heartbeats: [
      { name: 'OCPP Device', key: 'heartbeat',    topic: 'ev/UDN001/heartbeat',     lastSeen: m(2),  online: true,  connstate: undefined },
      { name: 'Pi5',  key: 'heartbeatPi5', topic: 'ev/UDN001/heartbeatPI5',  lastSeen: m(3),  online: true,  connstate: undefined },
      { name: 'Router',  key: 'router',       topic: 'ev/UDN001/router/status', lastSeen: m(4),  online: true,  connstate: 'Connected' },
    ],
    routerData: {
      connstate: 'Connected', tempRaw: 740,
      rssi: -50, rsrp: -82, rsrq: -13, sinr: 3,
      conntype: 'LTE', operator: 'DTAC', opernum: 52005,
      ip: ['10.88.66.33'], model: 'EC25-EU', manuf: 'Quectel',
      imei: '864303053088888', iccid: '8966032310012000008F',
      lastSeen: m(4), online: true,
    },
    powerModuleHeads: [
      { head: 1, pmCount: 2, voltage: 414.0, current: 110, powerKw: 45.5, prevVoltage: 410, prevCurrent: 108, timestamp: m(5), online: true },
      { head: 2, pmCount: 2, voltage: 413.5, current: 108, powerKw: 44.7, prevVoltage: 409, prevCurrent: 106, timestamp: m(4), online: true },
    ],
    meterHistory: genMeterHistory(11, 68_000_000, 72_000_000),
    tempHistory:  genTempHistory(11, 74.0),
    fanData: {
      fans: { 'FAN 1': 5380, 'FAN 2': 5360, 'FAN 3': 5400, 'FAN 4': 5370, 'FAN 5': 5390, 'FAN 6': 5350, 'FAN 7': 5410, 'FAN 8': 5340 },
      timestamp: m(3),
    },
    scripts: [
      { name: 'meter_reader', description: 'RS485 meter → MQTT bridge',      mqttTopic: 'ev/UDN001/script/meter_hb',   lastHeartbeat: m(5),  online: true,  expectedInterval: 60 },
      { name: 'fault_status', description: 'Fault status heartbeat monitor',  mqttTopic: 'ev/UDN001/script/fault_hb',   lastHeartbeat: m(3),  online: true,  expectedInterval: 30 },
      { name: 'state_plc',    description: 'PLC state heartbeat monitor',     mqttTopic: 'ev/UDN001/script/plc_hb',     lastHeartbeat: m(2),  online: true,  expectedInterval: 30 },
      { name: 'hb_sender',    description: 'Main heartbeat broadcaster',      mqttTopic: 'ev/UDN001/script/hb_send',    lastHeartbeat: m(2),  online: true,  expectedInterval: 60 },
      { name: 'plc_bridge',   description: 'Modbus TCP ↔ MQTT bridge',        mqttTopic: 'ev/UDN001/script/plc_bridge', lastHeartbeat: m(4),  online: true,  expectedInterval: 30 },
    ],
    plcData: {
      head1: mockPlcHead(1, true, 11),
      head2: mockPlcHead(2, false, 11),
      ambientTemp: 40.5, ambientHum: 23.5, ambientPressure: 1008.8,
      pi5Temp: 51.2,
      hmiStatus: 'Active', plc1Status: 'Active', plc2Status: 'Active',
      lem1Status: 'Active', lem2Status: 'Active',
      fanStatus1_8: '1', timestamp: m(3),
    },
  },

  // ── NST-001 · Degraded: Pi5 offline, meter stalled ───────────────────────────
  'NST-001': {
    stationId: 'NST-001',
    heartbeats: [
      { name: 'OCPP Device', key: 'heartbeat',    topic: 'ev/NST001/heartbeat',     lastSeen: m(4),  online: true,  connstate: undefined },
      { name: 'Pi5',  key: 'heartbeatPi5', topic: 'ev/NST001/heartbeatPI5',  lastSeen: h(3),  online: false, connstate: undefined },
      { name: 'Router',  key: 'router',       topic: 'ev/NST001/router/status', lastSeen: m(6),  online: true,  connstate: 'Connected' },
    ],
    routerData: {
      connstate: 'Connected', tempRaw: 780,
      rssi: -65, rsrp: -98, rsrq: -19, sinr: -2,
      conntype: 'LTE', operator: 'AIS', opernum: 52001,
      ip: ['10.76.11.88'], model: 'EC25-EU', manuf: 'Quectel',
      imei: '864303053089999', iccid: '8966032410022100009F',
      lastSeen: m(6), online: true,
    },
    powerModuleHeads: [
      { head: 1, pmCount: 1, voltage: 408.0, current: 45, powerKw: 18.4, prevVoltage: 405, prevCurrent: 44, timestamp: m(8), online: true  },
      { head: 2, pmCount: 0, voltage: 0,     current: 0,  powerKw: 0,    prevVoltage: 0,   prevCurrent: 0,  timestamp: h(4), online: false },
    ],
    meterHistory: genMeterHistory(12, 30_000_000, 35_000_000, 72),
    tempHistory:  genTempHistory(12, 78.0),
    fanData: {
      fans: { 'FAN 1': 5100, 'FAN 2': 5080, 'FAN 3': 5120, 'FAN 4': 0, 'FAN 5': 5090, 'FAN 6': 5110, 'FAN 7': 5070, 'FAN 8': 5130 },
      timestamp: m(5),
    },
    scripts: [
      { name: 'meter_reader', description: 'RS485 meter → MQTT bridge',      mqttTopic: 'ev/NST001/script/meter_hb', lastHeartbeat: h(5),  online: false, expectedInterval: 60 },
      { name: 'fault_status', description: 'Fault status heartbeat monitor',  mqttTopic: 'ev/NST001/script/fault_hb', lastHeartbeat: m(4),  online: true,  expectedInterval: 30 },
      { name: 'state_plc',    description: 'PLC state heartbeat monitor',     mqttTopic: 'ev/NST001/script/plc_hb',   lastHeartbeat: m(3),  online: true,  expectedInterval: 30 },
      { name: 'hb_sender',    description: 'Main heartbeat broadcaster',      mqttTopic: 'ev/NST001/script/hb_send',  lastHeartbeat: m(2),  online: true,  expectedInterval: 60 },
    ],
    plcData: {
      head1: mockPlcHead(1, true, 12),
      head2: { ...mockPlcHead(2, false, 12), chargeState: 'Fault', headError: 1, errorMessage: 'E03 Communication error' },
      ambientTemp: 44.1, ambientHum: 29.3, ambientPressure: 1005.2,
      pi5Temp: 56.7,
      hmiStatus: 'Active', plc1Status: 'Active', plc2Status: 'Inactive',
      lem1Status: 'Active', lem2Status: 'Inactive',
      fanStatus1_8: '1', timestamp: m(5),
    },
  },

  // ── RYG-001 · Online ──────────────────────────────────────────────────────────
  'RYG-001': {
    stationId: 'RYG-001',
    heartbeats: [
      { name: 'OCPP Device', key: 'heartbeat',    topic: 'ev/RYG001/heartbeat',     lastSeen: m(2),  online: true,  connstate: undefined },
      { name: 'Pi5',  key: 'heartbeatPi5', topic: 'ev/RYG001/heartbeatPI5',  lastSeen: m(1),  online: true,  connstate: undefined },
      { name: 'Router',  key: 'router',       topic: 'ev/RYG001/router/status', lastSeen: m(3),  online: true,  connstate: 'Connected' },
    ],
    routerData: {
      connstate: 'Connected', tempRaw: 700,
      rssi: -35, rsrp: -68, rsrq: -10, sinr: 8,
      conntype: 'LTE', operator: 'TRUE', opernum: 52004,
      ip: ['10.55.77.19'], model: 'EC25-EU', manuf: 'Quectel',
      imei: '864303053090000', iccid: '8966032410022200010F',
      lastSeen: m(3), online: true,
    },
    powerModuleHeads: [
      { head: 1, pmCount: 3, voltage: 422.0, current: 148, powerKw: 62.5, prevVoltage: 418, prevCurrent: 145, timestamp: m(3), online: true },
      { head: 2, pmCount: 3, voltage: 421.5, current: 146, powerKw: 61.6, prevVoltage: 417, prevCurrent: 144, timestamp: m(2), online: true },
    ],
    meterHistory: genMeterHistory(13, 110_000_000, 115_000_000),
    tempHistory:  genTempHistory(13, 70.0),
    fanData: {
      fans: { 'FAN 1': 5550, 'FAN 2': 5530, 'FAN 3': 5560, 'FAN 4': 5520, 'FAN 5': 5540, 'FAN 6': 5510, 'FAN 7': 5570, 'FAN 8': 5500 },
      timestamp: m(1),
    },
    scripts: [
      { name: 'meter_reader', description: 'RS485 meter → MQTT bridge',      mqttTopic: 'ev/RYG001/script/meter_hb',   lastHeartbeat: m(3),  online: true,  expectedInterval: 60 },
      { name: 'fault_status', description: 'Fault status heartbeat monitor',  mqttTopic: 'ev/RYG001/script/fault_hb',   lastHeartbeat: m(1),  online: true,  expectedInterval: 30 },
      { name: 'state_plc',    description: 'PLC state heartbeat monitor',     mqttTopic: 'ev/RYG001/script/plc_hb',     lastHeartbeat: m(2),  online: true,  expectedInterval: 30 },
      { name: 'hb_sender',    description: 'Main heartbeat broadcaster',      mqttTopic: 'ev/RYG001/script/hb_send',    lastHeartbeat: m(1),  online: true,  expectedInterval: 60 },
      { name: 'plc_bridge',   description: 'Modbus TCP ↔ MQTT bridge',        mqttTopic: 'ev/RYG001/script/plc_bridge', lastHeartbeat: m(2),  online: true,  expectedInterval: 30 },
      { name: 'fan_monitor',  description: 'EBM fan RPM sampler',             mqttTopic: 'ev/RYG001/script/fan_hb',     lastHeartbeat: m(1),  online: true,  expectedInterval: 30 },
    ],
    plcData: {
      head1: mockPlcHead(1, true, 13),
      head2: mockPlcHead(2, true, 13),
      ambientTemp: 38.8, ambientHum: 20.0, ambientPressure: 1010.5,
      pi5Temp: 46.5,
      hmiStatus: 'Active', plc1Status: 'Active', plc2Status: 'Active',
      lem1Status: 'Active', lem2Status: 'Active',
      fanStatus1_8: '1', timestamp: m(1),
    },
  },
};

// ── Alerts ────────────────────────────────────────────────────────────────────
export const MOCK_ALERTS: Alert[] = [
  { id: 'ALT-001', stationId: 'BKK-002', stationName: 'BKK-002', type: 'heartbeat',   severity: 'critical', message: 'Pi5 offline — last seen 2 hours ago',         timestamp: h(2),  acknowledged: false },
  { id: 'ALT-002', stationId: 'BKK-002', stationName: 'BKK-002', type: 'temperature', severity: 'warning',  message: 'Router temp 79.0 °C — approaching threshold (80 °C)',      timestamp: m(45), acknowledged: false },
  { id: 'ALT-003', stationId: 'BKK-002', stationName: 'BKK-002', type: 'meter',       severity: 'warning',  message: 'Meter 2 value unchanged for 3 days — LED red',             timestamp: d(3),  acknowledged: true  },
  { id: 'ALT-004', stationId: 'CNX-001', stationName: 'CNX-001', type: 'heartbeat',   severity: 'critical', message: 'All heartbeats offline — station unreachable',              timestamp: h(5),  acknowledged: false },
  { id: 'ALT-005', stationId: 'BKK-001', stationName: 'BKK-001', type: 'fan',         severity: 'warning',  message: 'FAN 6 RPM = 0 — possible fault',                           timestamp: m(30), acknowledged: false },
  { id: 'ALT-006', stationId: 'BKK-001', stationName: 'BKK-001', type: 'script',      severity: 'warning',  message: 'fan_monitor script offline — no heartbeat for 1h',          timestamp: h(1),  acknowledged: false },
  { id: 'ALT-007', stationId: 'BKK-002', stationName: 'BKK-002', type: 'plc',         severity: 'warning',  message: 'Head 2: Fault — E05 Insulation fault',                     timestamp: h(1),  acknowledged: false },
  { id: 'ALT-008', stationId: 'BKK-004', stationName: 'BKK-004', type: 'temperature', severity: 'critical', message: 'Router temp 84.0 °C — above threshold (80 °C)',             timestamp: m(20), acknowledged: false },
  { id: 'ALT-009', stationId: 'BKK-004', stationName: 'BKK-004', type: 'fan',         severity: 'warning',  message: 'FAN 3, FAN 7 RPM = 0 — possible fault',                    timestamp: m(25), acknowledged: false },
  { id: 'ALT-010', stationId: 'BKK-004', stationName: 'BKK-004', type: 'script',      severity: 'warning',  message: 'state_plc script offline — no heartbeat for 2h',           timestamp: h(2),  acknowledged: false },
  { id: 'ALT-011', stationId: 'PKT-001', stationName: 'PKT-001', type: 'fan',         severity: 'warning',  message: 'FAN 8 RPM = 0 — possible fault',                           timestamp: m(40), acknowledged: false },
  { id: 'ALT-012', stationId: 'PKT-001', stationName: 'PKT-001', type: 'script',      severity: 'warning',  message: 'state_plc script offline — no heartbeat for 3h',           timestamp: h(3),  acknowledged: true  },
  { id: 'ALT-013', stationId: 'PTY-001', stationName: 'PTY-001', type: 'heartbeat',   severity: 'critical', message: 'All heartbeats offline — station unreachable',              timestamp: h(10), acknowledged: false },
  { id: 'ALT-014', stationId: 'NST-001', stationName: 'NST-001', type: 'heartbeat',   severity: 'critical', message: 'Pi5 offline — last seen 3 hours ago',           timestamp: h(3),  acknowledged: false },
  { id: 'ALT-015', stationId: 'NST-001', stationName: 'NST-001', type: 'meter',       severity: 'warning',  message: 'Meter 2 value unchanged for 3 days — LED red',             timestamp: d(3),  acknowledged: false },
  { id: 'ALT-016', stationId: 'NST-001', stationName: 'NST-001', type: 'plc',         severity: 'warning',  message: 'Head 2: Fault — E03 Communication error',                  timestamp: m(50), acknowledged: false },
  { id: 'ALT-017', stationId: 'NST-001', stationName: 'NST-001', type: 'fan',         severity: 'warning',  message: 'FAN 4 RPM = 0 — possible fault',                           timestamp: m(55), acknowledged: true  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
export function getStationStatus(id: string): 'online' | 'degraded' | 'offline' {
  const data = MOCK_DASHBOARD[id];
  if (!data) return 'offline';
  const hbOnline = data.heartbeats.filter(h => h.online).length;
  if (hbOnline === 0) return 'offline';
  const pmOnline = data.powerModuleHeads.some(p => p.online);
  const scriptOk = data.scripts.every(s => s.online);
  if (hbOnline < data.heartbeats.length || !pmOnline || !scriptOk) return 'degraded';
  return 'online';
}

// LED status for a single meter stream (check if value changed in last 2 days)
export function getMeterLed(history: MeterSnapshot[], which: 1 | 2): 'ok' | 'error' {
  if (history.length < 2) return 'error';
  const latest = history[history.length - 1];
  const latestVal = which === 1 ? latest.meter1Wh : latest.meter2Wh;
  const cutoff = new Date(latest.timestamp).getTime() - 2 * 86_400_000;
  const old = history.find(r => new Date(r.timestamp).getTime() <= cutoff);
  if (!old) return 'ok';
  const oldVal = which === 1 ? old.meter1Wh : old.meter2Wh;
  return latestVal === oldVal ? 'error' : 'ok';
}
