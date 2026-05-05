/**
 * Shared MongoDB client for Next.js API routes.
 * Reuses connection across hot-reloads in development.
 */

import { MongoClient, Db } from 'mongodb';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://EDS:EV1@45.91.135.9:27017/';
const MONGO_DB  = process.env.MONGO_DB  || 'ev_monitor';

let client: MongoClient | null = null;
let db: Db | null = null;

// Cache on globalThis to survive HMR in dev
const g = globalThis as any;

export async function getMongoDb(): Promise<Db> {
  if (g.__mongoDb) return g.__mongoDb;

  if (!client) {
    client = g.__mongoClient || new MongoClient(MONGO_URI);
    g.__mongoClient = client;
    await client!.connect();
  }

  db = client!.db(MONGO_DB);
  g.__mongoDb = db;
  return db;
}
