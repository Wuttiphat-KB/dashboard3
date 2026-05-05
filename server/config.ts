import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '..', '.env.local') });

export const ENV = {
  MONGO_URI:            process.env.MONGO_URI            || 'mongodb://localhost:27017/',
  MONGO_DB:             process.env.MONGO_DB             || 'ev_monitor',
  MQTT_URL:             process.env.MQTT_URL             || 'mqtt://localhost:1883',
  WS_PORT:              parseInt(process.env.WS_PORT     || '4100', 10),
  HEARTBEAT_TIMEOUT_MS: parseInt(process.env.HEARTBEAT_TIMEOUT_MS || '300000', 10),  // 5 min
};
