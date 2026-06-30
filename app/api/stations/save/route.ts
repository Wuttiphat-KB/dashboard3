import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getMongoClient } from '@/lib/mongoClient';
import { invalidateFleetCache } from '@/lib/fleetCache';
import { invalidateStationsCache } from '@/lib/stationsCache';

const STATION_DB = 'Station';
const COOKIE_NAME = 'cfg_pin';

// MongoDB collection name rules — only allow what's safe to round-trip through
// `db.collection(name)`. Excludes `$`, `.`, whitespace, control chars, etc.
const VALID_NAME_RE = /^[A-Za-z0-9_-]{1,80}$/;

function deepTrim<T>(v: T): T {
  if (typeof v === 'string') return v.trim() as any;
  if (Array.isArray(v)) return v.map(deepTrim) as any;
  if (v && typeof v === 'object') {
    const out: any = {};
    for (const [k, val] of Object.entries(v)) out[k] = deepTrim(val);
    return out;
  }
  return v;
}

/**
 * POST /api/stations/save
 * Saves station config to MongoDB database "Station", collection = station.name.
 *
 * Handles three cases atomically:
 *   - ADD     : new id, name not taken              → insert
 *   - EDIT    : existing id, same name              → update in place
 *   - RENAME  : existing id, name changed           → write new, drop old collection
 *
 * Rejects:
 *   - missing name
 *   - invalid name characters (Mongo collection rules)
 *   - name already used by a different station (collision)
 */
export async function POST(req: NextRequest) {
  try {
    // Auth gate
    const expectedPin = process.env.CONFIG_PIN || '';
    if (expectedPin) {
      const jar = await cookies();
      if (jar.get(COOKIE_NAME)?.value !== expectedPin) {
        return NextResponse.json({ error: 'PIN required' }, { status: 401 });
      }
    }

    const raw = await req.json();
    const station = deepTrim(raw);

    // ── Validate name ──
    const name: string = station.name || '';
    if (!name) {
      return NextResponse.json({ error: 'station.name is required' }, { status: 400 });
    }
    if (!VALID_NAME_RE.test(name)) {
      return NextResponse.json({
        error: `station.name must match ${VALID_NAME_RE} (letters, digits, _ or -, max 80 chars)`,
      }, { status: 400 });
    }
    if (!station.id) {
      return NextResponse.json({ error: 'station.id is required' }, { status: 400 });
    }

    // Strip MongoDB-managed fields
    const { _id, ...stationData } = station;

    const client = await getMongoClient();
    const db = client.db(STATION_DB);

    // ── Look up the previous record (by id) to detect rename ──
    const previous = await db.collection('_stations').findOne({ id: station.id });
    const isEdit = !!previous;
    const previousName: string | undefined = previous?.name;
    const isRename = isEdit && previousName && previousName !== name;

    // ── Reject if `name` is already used by a DIFFERENT station ──
    const nameOwner = await db.collection('_stations').findOne({ name });
    if (nameOwner && nameOwner.id !== station.id) {
      return NextResponse.json({
        error: `Name "${name}" is already used by station id="${nameOwner.id}". Pick a different name.`,
      }, { status: 409 });
    }

    // ── Reject if `id` is already used by a different station with a different name ──
    // (handled implicitly above — if id exists, previous.name dictates the rename path)

    const collectionName = name;
    const ops: Promise<unknown>[] = [];

    // Upsert into the canonical per-station collection.
    ops.push(
      db.collection(collectionName).updateOne(
        { id: station.id },
        { $set: { ...stationData, updatedAt: new Date() } },
        { upsert: true },
      ),
    );

    // Always refresh the mirror — single source of truth for /api/fleet.
    ops.push(
      db.collection('_stations').updateOne(
        { id: station.id },
        { $set: { ...stationData, syncedAt: new Date() } },
        { upsert: true },
      ),
    );

    await Promise.all(ops);

    // ── Rename cleanup: drop the old collection so slow scans / restarts can't
    //    revert to its stale doc.
    if (isRename && previousName) {
      try {
        await db.collection(previousName).deleteMany({ id: station.id }).catch(() => {});
        const remaining = await db.collection(previousName).countDocuments().catch(() => 1);
        if (remaining === 0) {
          await db.collection(previousName).drop().catch(() => {});
        }
      } catch {
        // Non-fatal — orphan will be filtered by the canonical-doc rule on next slow scan.
      }
    }

    invalidateFleetCache();
    invalidateStationsCache();

    return NextResponse.json({
      ok: true,
      mode: isRename ? 'rename' : isEdit ? 'edit' : 'add',
      db: STATION_DB,
      collection: collectionName,
      previousCollection: isRename ? previousName : undefined,
    });
  } catch (err: any) {
    console.error('[api/stations/save] error:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
}
