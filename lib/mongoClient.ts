/**
 * Shared MongoDB client for Next.js API routes.
 * Reuses connection across hot-reloads in development and across requests in production.
 *
 * IMPORTANT: every API route MUST use these helpers — never `new MongoClient(...)` per request.
 * Creating a client per request opens/closes a fresh connection pool each time, which is the
 * primary cause of /api/fleet appearing to hang under load.
 */

import { MongoClient, Db } from 'mongodb';
import { MONGO_URI } from './env';

const MONGO_DB = process.env.MONGO_DB || 'ev_monitor';

// Cache on globalThis to survive HMR in dev and module re-evaluation
const g = globalThis as any;

function buildClient(): MongoClient {
  return new MongoClient(MONGO_URI, {
    serverSelectionTimeoutMS: 8_000,
    // Allow many concurrent ops — /api/fleet fans out ~5 queries × ~200 stations.
    maxPoolSize: 50,
    minPoolSize: 5,
  });
}

export async function getMongoClient(): Promise<MongoClient> {
  if (g.__mongoClientPromise) return g.__mongoClientPromise;
  const client = buildClient();
  g.__mongoClientPromise = client.connect();
  try {
    await g.__mongoClientPromise;
    g.__mongoClient = client;
    return client;
  } catch (err) {
    // Allow a retry on next call
    g.__mongoClientPromise = null;
    throw err;
  }
}

export async function getMongoDb(): Promise<Db> {
  if (g.__mongoDb) return g.__mongoDb;
  const client = await getMongoClient();
  const db = client.db(MONGO_DB);
  g.__mongoDb = db;
  return db;
}
