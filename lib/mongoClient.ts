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
    // /api/fleet fans out ~4 queries × ~200 stations = 800 concurrent ops.
    // With a 50-slot pool that's 16 sequential rounds on an already-slow Mongo.
    // 200 lets them all run in parallel.
    maxPoolSize: 200,
    minPoolSize: 10,
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
