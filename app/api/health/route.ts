import { NextResponse } from 'next/server';
import { getMongoClient } from '@/lib/mongoClient';

/**
 * GET /api/health
 * Lightweight liveness check — verifies MongoDB is reachable and reports basic stats.
 * Use this to isolate "is Mongo OK?" from the much heavier /api/fleet query.
 */
export async function GET() {
  const t0 = Date.now();
  try {
    const tConn = Date.now();
    const client = await getMongoClient();
    const connectMs = Date.now() - tConn;

    const tPing = Date.now();
    const admin = client.db().admin();
    const ping = await admin.ping();
    const pingMs = Date.now() - tPing;

    const tList = Date.now();
    const stationDb = client.db('Station');
    const cols = await stationDb.listCollections().toArray();
    const listMs = Date.now() - tList;

    const tCount = Date.now();
    const sampleCount = await stationDb.collection('_device_status').countDocuments();
    const countMs = Date.now() - tCount;

    return NextResponse.json({
      ok: true,
      mongo: ping?.ok === 1 ? 'connected' : 'unknown',
      timings: {
        connectMs,
        pingMs,
        listCollectionsMs: listMs,
        countMs,
        totalMs: Date.now() - t0,
      },
      stationDb: {
        totalCollections: cols.length,
        deviceStatusDocs: sampleCount,
      },
    });
  } catch (err: any) {
    console.error('[api/health] FAILED:', err?.message || err);
    return NextResponse.json({
      ok: false,
      error: err?.message || String(err),
      totalMs: Date.now() - t0,
    }, { status: 500 });
  }
}
