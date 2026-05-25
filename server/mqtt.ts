import mqtt, { MqttClient } from 'mqtt';
import { ENV } from './config';

export type MsgHandler = (stationId: string, topic: string, payload: unknown) => void;

interface Subscription {
  stationId: string;
  key: string;          // 'heartbeat' | 'router' | 'meter' | ...
}

let client: MqttClient | null = null;
const handlers = new Map<string, MsgHandler[]>();

/**
 * topic → list of (stationId, key) tuples that should receive its messages.
 *
 * Several charger stations sometimes share one physical router and therefore
 * one MQTT topic. The old 1-to-1 design overwrote the prior entry whenever
 * a second station registered the same topic, silently breaking the first
 * station. Storing an array fans the message out to every subscriber.
 */
const topicSubs = new Map<string, Subscription[]>();

/** stationId → list of topics subscribed for that station (for unregister) */
const stationTopics = new Map<string, Set<string>>();

export function onMessage(key: string, handler: MsgHandler): void {
  const arr = handlers.get(key) || [];
  arr.push(handler);
  handlers.set(key, arr);
}

export function registerStation(stationId: string, topics: Record<string, string>): void {
  let topicSet = stationTopics.get(stationId);
  if (!topicSet) { topicSet = new Set(); stationTopics.set(stationId, topicSet); }

  for (const [key, topic] of Object.entries(topics)) {
    if (!topic) continue;

    // Append (or replace) this station's subscription for the topic.
    const subs = topicSubs.get(topic) || [];
    // Drop any prior subscription from the same station+key (idempotent re-register)
    const filtered = subs.filter(s => !(s.stationId === stationId && s.key === key));
    filtered.push({ stationId, key });
    topicSubs.set(topic, filtered);
    topicSet.add(topic);

    // Only subscribe to the broker once per topic.
    if (filtered.length === 1) {
      client?.subscribe(topic, (err) => {
        if (err) console.error(`[mqtt] subscribe error ${topic}:`, err.message);
      });
    }
  }
}

/** Unsubscribe all topics for a station (used on edit/delete) */
export function unregisterStation(stationId: string): void {
  const topics = stationTopics.get(stationId);
  if (!topics) return;
  for (const topic of topics) {
    const subs = topicSubs.get(topic);
    if (!subs) continue;
    const remaining = subs.filter(s => s.stationId !== stationId);
    if (remaining.length === 0) {
      // No one else needs this topic — fully unsubscribe.
      topicSubs.delete(topic);
      client?.unsubscribe(topic);
    } else {
      // Other stations still need this topic — keep the broker subscription.
      topicSubs.set(topic, remaining);
    }
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
    for (const topic of topicSubs.keys()) {
      client!.subscribe(topic);
    }
  });

  client.on('message', (topic, buf) => {
    const subs = topicSubs.get(topic);
    if (!subs || subs.length === 0) return;

    let payload: unknown;
    try {
      payload = JSON.parse(buf.toString());
    } catch {
      payload = buf.toString();
    }

    // Fan out to EVERY station + key subscribed to this topic.
    for (const sub of subs) {
      const fns = handlers.get(sub.key);
      if (!fns) continue;
      for (const fn of fns) {
        fn(sub.stationId, topic, payload);
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
