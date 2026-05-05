import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '..', '.env.local') });

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}. Set it in .env.local`);
  return v;
}

export const ENV = {
  MONGO_URI:            required('MONGO_URI'),
  MONGO_DB:             process.env.MONGO_DB || 'ev_monitor',
  MQTT_URL:             required('MQTT_URL'),
  WS_PORT:              parseInt(process.env.WS_PORT || '4100', 10),
  HEARTBEAT_TIMEOUT_MS: parseInt(process.env.HEARTBEAT_TIMEOUT_MS || '300000', 10),  // 5 min
};
