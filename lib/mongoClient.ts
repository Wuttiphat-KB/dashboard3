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
    // A 200-slot pool does not make a single-node Mongo faster — it just lets the
    // app dump 800 concurrent ops on it, which is how /api/fleet ended up taking
    // 20+ minutes per request. Now that the route rebuilds at most once per 10s
    // (lib/apiCache) the fan-out is bounded, and a smaller pool keeps Mongo in a
    // range where it answers quickly instead of thrashing.
    maxPoolSize: 50,
    minPoolSize: 5,
    // Never let a request queue on the pool indefinitely — fail it and let the
    // caller fall back to cached data rather than piling up behind a stuck query.
    waitQueueTimeoutMS: 15_000,
    maxIdleTimeMS: 60_000,
  });
}

export async function getMongoClient(): Promise<MongoClient> {
  if (g.__mongoClient) return g.__mongoClient;
  if (g.__mongoClientPromise) return g.__mongoClientPromise;
  const client = buildClient();
  const masked = MONGO_URI.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@');
  console.log(`[mongo] connecting to ${masked} ...`);
  const tStart = Date.now();
  g.__mongoClientPromise = (async () => {
    try {
      await client.connect();
      g.__mongoClient = client;
      console.log(`[mongo] connected in ${Date.now() - tStart}ms`);
      return client;
    } catch (err: any) {
      console.error(`[mongo] connection failed after ${Date.now() - tStart}ms:`, err?.message || err);
      g.__mongoClientPromise = null;
      throw err;
    }
  })();
  return g.__mongoClientPromise;
}

export async function getMongoDb(): Promise<Db> {
  if (g.__mongoDb) return g.__mongoDb;
  const client = await getMongoClient();
  const db = client.db(MONGO_DB);
  g.__mongoDb = db;
  return db;
}
