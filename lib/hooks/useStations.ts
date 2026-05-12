'use client';

import { useState, useEffect } from 'react';
import { Station, StationDashboardData, HeartbeatDevice, PowerModuleHead, MeterSnapshot, RouterData, FanSnapshot, MqttScript, PlcData, PlcHeadData } from '@/lib/types';
import { getStations, getDashboard, subscribe } from './dataCache';

const emptyPlcHead = (head: number): PlcHeadData => ({
  head, chargeState: 'Unknown', iRessState: 0, soc: 0,
  targetVoltage: 0, targetCurrent: 0, presentVoltage: 0, presentCurrent: 0,
  powerKw: 0, measuredVoltage: 0, measuredCurrent: 0,
  temp1Head: 0, temp2Head: 0, tempPowerModule: 0, fanStatus: 0,
  headError: 0, errorMessage: '', cpStatus: 0, activeMld: 0,
  insulationFault: 0, warningInsulation: 0,
  maxPower: 0, maxCurrent: 0, maxVoltage: 0, icp: 0, usl: 0, dynamicMaxCurrent: 0,
});

/** Cached stations list — instant on subsequent navigations */
export function useStations() {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const c = getStations();
    const unsub = subscribe(c, () => forceUpdate(n => n + 1));
    const timer = setInterval(() => { getStations(); }, 30_000);  // Stations rarely change
    return () => { unsub(); clearInterval(timer); };
  }, []);

  const c = getStations();
  return {
    stations: c.data || [],
    loading: c.loading && !c.data,
  };
}

/** Cached per-station dashboard */
export function useDashboard(stationId: string) {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const c = getDashboard(stationId);
    const unsub = subscribe(c, () => forceUpdate(n => n + 1));
    const timer = setInterval(() => { getDashboard(stationId); }, 30_000);
    return () => { unsub(); clearInterval(timer); };
  }, [stationId]);

  const c = getDashboard(stationId);
  const data = c.data ? mapApiToDashboard(stationId, c.data) : null;

  return {
    data,
    loading: c.loading && !c.data,
  };
}

function mapApiToDashboard(stationId: string, raw: any): StationDashboardData {
  const hb = raw.heartbeat || {};
  const pi5 = raw.pi5 || {};
  const hasPi5 = raw.station?.hasPi5 !== false;  // default true
  const heartbeats: HeartbeatDevice[] = [
    { name: 'OCPP Device', key: 'heartbeat',    topic: '', lastSeen: hb.lastSeen || '', online: !!hb.online },
    ...(hasPi5 ? [{
      name: 'Pi5', key: 'heartbeatPi5' as const, topic: '', lastSeen: pi5.lastSeen || '', online: !!pi5.online,
    }] : []),
    { name: 'Router',      key: 'router',       topic: '', lastSeen: raw.routerData?.lastSeen || '', online: !!raw.routerData?.online, connstate: raw.routerData?.connstate || 'Unknown' },
  ];

  const numHeads = raw.station?.chargerHeads || 2;
  const pmHeads: PowerModuleHead[] = (raw.powerModuleHeads || [])
    .filter((h: any) => h.head <= numHeads)
    .map((h: any) => ({
      head: h.head, pmCount: h.pmCount || 0, voltage: h.voltage || 0, current: h.current || 0,
      powerKw: h.powerKw || 0, prevVoltage: h.prevVoltage || 0, prevCurrent: h.prevCurrent || 0,
      timestamp: h.timestamp || '', online: h.online ?? false,
    }));

  const meterHistory: MeterSnapshot[] = (raw.meterHistory || []).map((m: any) => ({
    meter1Wh: m.meter1Wh || 0, meter2Wh: m.meter2Wh || 0,
    timestamp1: m.timestamp1 || '', timestamp2: m.timestamp2 || '', timestamp: m.timestamp || '',
  }));

  const r = raw.routerData || {};
  const routerData: RouterData = {
    connstate: r.connstate || 'Unknown',
    tempRaw:   Number(r.tempRaw ?? 0),
    rssi:      Number(r.rssi ?? 0),
    rsrp:      Number(r.rsrp ?? 0),
    rsrq:      Number(r.rsrq ?? 0),
    sinr:      Number(r.sinr ?? 0),
    conntype:  String(r.conntype ?? ''),
    operator:  String(r.operator ?? ''),
    opernum:   Number(r.opernum ?? 0),
    ip:        Array.isArray(r.ip) ? r.ip : [],
    model:     String(r.model ?? ''),
    manuf:     String(r.manuf ?? ''),
    imei:      String(r.imei ?? ''),
    iccid:     String(r.iccid ?? ''),
    lastSeen:  r.lastSeen || '',
    online:    !!r.online,
  };

  const fanData: FanSnapshot = {
    fans: raw.fanData?.fans || {},
    timestamp: raw.fanData?.timestamp || '',
  };

  const scripts: MqttScript[] = (raw.scripts || []).length > 0
    ? raw.scripts.map((s: any) => ({
        name: s.name,
        description: s.description || '',
        mqttTopic: s.mqttTopic || '',
        lastHeartbeat: s.lastHeartbeat || '',
        online: !!s.online,
        expectedInterval: s.expectedInterval || 30,
      }))
    : [
        { name: 'fault_status', description: 'Fault status heartbeat', mqttTopic: '', lastHeartbeat: '', online: false, expectedInterval: 30 },
        { name: 'plc',          description: 'PLC data heartbeat',     mqttTopic: '', lastHeartbeat: '', online: false, expectedInterval: 30 },
      ];

  const plcRaw = raw.plcData;
  const plcData: PlcData = plcRaw ? {
    head1: { ...emptyPlcHead(1),
      chargeState: plcRaw.head1?.chargeState || 'Unknown',
      soc: plcRaw.head1?.soc || 0, powerKw: plcRaw.head1?.powerKw || 0,
      presentVoltage: plcRaw.head1?.presentVoltage || 0, presentCurrent: plcRaw.head1?.presentCurrent || 0,
      temp1Head: plcRaw.head1?.temp1Head || 0, temp2Head: plcRaw.head1?.temp2Head || 0,
      tempPowerModule: plcRaw.head1?.tempPowerModule || 0, fanStatus: plcRaw.head1?.fanStatus || 0,
      headError: plcRaw.head1?.headError || 0, errorMessage: plcRaw.head1?.errorMessage || '',
      activeMld: plcRaw.head1?.activeMld || 0,
    },
    head2: { ...emptyPlcHead(2),
      chargeState: plcRaw.head2?.chargeState || 'Unknown',
      soc: plcRaw.head2?.soc || 0, powerKw: plcRaw.head2?.powerKw || 0,
      presentVoltage: plcRaw.head2?.presentVoltage || 0, presentCurrent: plcRaw.head2?.presentCurrent || 0,
      temp1Head: plcRaw.head2?.temp1Head || 0, temp2Head: plcRaw.head2?.temp2Head || 0,
      tempPowerModule: plcRaw.head2?.tempPowerModule || 0, fanStatus: plcRaw.head2?.fanStatus || 0,
      headError: plcRaw.head2?.headError || 0, errorMessage: plcRaw.head2?.errorMessage || '',
      activeMld: plcRaw.head2?.activeMld || 0,
    },
    ambientTemp: 0, ambientHum: 0, ambientPressure: 0, pi5Temp: 0,
    hmiStatus: 'Unknown', plc1Status: 'Unknown', plc2Status: 'Unknown',
    lem1Status: 'Unknown', lem2Status: 'Unknown', fanStatus1_8: '0',
    timestamp: plcRaw.timestamp || '',
  } : {
    head1: emptyPlcHead(1), head2: emptyPlcHead(2),
    ambientTemp: 0, ambientHum: 0, ambientPressure: 0, pi5Temp: 0,
    hmiStatus: 'Unknown', plc1Status: 'Unknown', plc2Status: 'Unknown',
    lem1Status: 'Unknown', lem2Status: 'Unknown', fanStatus1_8: '0', timestamp: '',
  };

  return {
    stationId, heartbeats, routerData,
    powerModuleHeads: pmHeads.length > 0 ? pmHeads : [
      { head: 1, pmCount: 0, voltage: 0, current: 0, powerKw: 0, prevVoltage: 0, prevCurrent: 0, timestamp: '', online: false },
      { head: 2, pmCount: 0, voltage: 0, current: 0, powerKw: 0, prevVoltage: 0, prevCurrent: 0, timestamp: '', online: false },
    ],
    meterHistory, tempHistory: [], fanData, scripts, plcData,
  };
}
