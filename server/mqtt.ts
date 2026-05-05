import mqtt, { MqttClient } from 'mqtt';
import { ENV } from './config';

export type MsgHandler = (stationId: string, topic: string, payload: unknown) => void;

let client: MqttClient | null = null;
const handlers = new Map<string, MsgHandler[]>();
const topicMap = new Map<string, { stationId: string; key: string }>();
/** stationId → list of topics subscribed for that station (for unregister) */
const stationTopics = new Map<string, Set<string>>();

export function onMessage(key: string, handler: MsgHandler): void {
  const arr = handlers.get(key) || [];
  arr.push(handler);
  handlers.set(key, arr);
}

export function registerStation(stationId: string, topics: Record<string, string>): void {
  // Track which topics belong to this station
  let topicSet = stationTopics.get(stationId);
  if (!topicSet) { topicSet = new Set(); stationTopics.set(stationId, topicSet); }

  for (const [key, topic] of Object.entries(topics)) {
    if (!topic) continue;
    topicMap.set(topic, { stationId, key });
    topicSet.add(topic);
    client?.subscribe(topic, (err) => {
      if (err) console.error(`[mqtt] subscribe error ${topic}:`, err.message);
    });
  }
}

/** Unsubscribe all topics for a station (used on edit/delete) */
export function unregisterStation(stationId: string): void {
  const topics = stationTopics.get(stationId);
  if (!topics) return;
  for (const topic of topics) {
    topicMap.delete(topic);
    client?.unsubscribe(topic);
  }
  stationTopics.delete(stationId);
}

/** Get the topic set currently registered for a station */
export function getStationTopics(stationId: string): Set<string> | undefined {
  return stationTopics.get(stationId);
}

export function connectMqtt(): MqttClient {
  client = mqtt.connect(ENV.MQTT_URL);

  client.on('connect', () => {
    console.log(`[mqtt] connected → ${ENV.MQTT_URL}`);
    for (const topic of topicMap.keys()) {
      client!.subscribe(topic);
    }
  });

  client.on('message', (topic, buf) => {
    const entry = topicMap.get(topic);
    if (!entry) return;

    let payload: unknown;
    try {
      payload = JSON.parse(buf.toString());
    } catch {
      payload = buf.toString();
    }

    const fns = handlers.get(entry.key);
    if (fns) {
      for (const fn of fns) {
        fn(entry.stationId, topic, payload);
      }
    }
  });

  client.on('error', (err) => {
    console.error('[mqtt] error:', err.message);
  });

  client.on('reconnect', () => {
    console.log('[mqtt] reconnecting...');
  });

  return client;
}
