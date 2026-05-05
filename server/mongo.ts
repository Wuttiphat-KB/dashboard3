import { MongoClient, Db } from 'mongodb';
import { ENV } from './config';

let client: MongoClient | null = null;

export async function connectMongo(): Promise<MongoClient> {
  if (client) return client;
  client = new MongoClient(ENV.MONGO_URI);
  await client.connect();
  console.log(`[mongo] connected`);
  return client;
}

/** Get a specific database by name */
export function getDbByName(name: string): Db {
  if (!client) throw new Error('MongoDB not connected');
  return client.db(name);
}

/** Shorthand — write alerts/edge events to Station DB (user has write access) */
export function getStationDb(): Db {
  return getDbByName('Station');
}

export async function closeMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}
