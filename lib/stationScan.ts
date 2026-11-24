import type { Db, Document, Filter } from 'mongodb';

/**
 * Reading station configs out of db=Station.
 *
 * Each station's config lives in its own collection (`Station.{station.name}`), and
 * `Station._stations` mirrors all of them so the dashboard needs one query instead of
 * ~230. When the mirror is empty, or the backend (re)starts, the per-station collections
 * are scanned. Shared by the backend, /api/stations and /api/fleet.
 *
 * Two things the scan must never do:
 *
 *  1. Trust `findOne()` blindly. The backend writes heartbeat / router edge events into
 *     `Station.{collection}` too, and per the station import those collection names are
 *     the station's own name — so a config collection can hold edge events as well. An
 *     unfiltered findOne() returns whichever document is first (an old event, e.g. after
 *     the station was deleted and re-added, since delete leaves the events behind), the
 *     station looks "missing" and the sync deletes it from `_stations`. Here the query
 *     only matches a document that looks like a config.
 *
 *  2. Hide a failed read. A collection that times out is reported in `failed` and makes
 *     `complete` false, so callers can refuse to delete anything based on a partial list.
 */

/** Per-collection ceiling: a slow Mongo should fail a read (reported) rather than hang the scan. */
const FINDONE_MAX_MS = 20_000;
const DEFAULT_CONCURRENCY = 20;

export interface StationScanOptions {
  /** Also require `mqttTopics` — the backend cannot register a station without it. */
  requireTopics?: boolean;
  concurrency?: number;
  maxTimeMS?: number;
}

export interface StationScanResult {
  /** One config doc per station id. */
  stations: Document[];
  /** False when at least one collection could not be read — the list may be missing stations. */
  complete: boolean;
  /** Names of the collections that could not be read. */
  failed: string[];
  /** How many per-station collections were examined. */
  scanned: number;
}

/** Matches a station config doc but not an edge event / status row stored beside it. */
export function configFilter(requireTopics = false): Filter<Document> {
  return requireTopics
    ? { id: { $exists: true }, mqttTopics: { $exists: true } }
    : { id: { $exists: true } };
}

/**
 * Scan every per-station collection and return one config doc per station id.
 *
 * Renaming a station via /config writes the NEW doc to `Station.{newName}` but may leave
 * the old `Station.{oldName}` collection with a doc carrying the same `id`. Pick the
 * canonical one, in priority order:
 *   1. the doc whose `name` equals its collection name;
 *   2. otherwise the most recently updated.
 */
export async function scanStationCollections(db: Db, opts: StationScanOptions = {}): Promise<StationScanResult> {
  const requireTopics = opts.requireTopics ?? false;
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
  const maxTimeMS = opts.maxTimeMS ?? FINDONE_MAX_MS;
  const filter = configFilter(requireTopics);

  const cols = await db.listCollections().toArray();
  const targets = cols.filter(c => !c.name.startsWith('system.') && !c.name.startsWith('_'));

  interface Candidate { doc: Document; updatedAt: number; canonical: boolean; }
  const bestById = new Map<string, Candidate>();
  const failed: string[] = [];

  for (let i = 0; i < targets.length; i += concurrency) {
    const batch = targets.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async col => {
        try {
          return { col: col.name, doc: await db.collection(col.name).findOne(filter, { maxTimeMS }) };
        } catch {
          failed.push(col.name);
          return { col: col.name, doc: null };
        }
      }),
    );
    for (const { col, doc } of results) {
      if (!doc || !doc.id) continue;
      if (requireTopics && !doc.mqttTopics) continue;
      const cand: Candidate = {
        doc,
        updatedAt: new Date(doc.updatedAt || 0).getTime(),
        canonical: doc.name === col,
      };
      const existing = bestById.get(doc.id);
      if (!existing
        || (cand.canonical && !existing.canonical)
        || (cand.canonical === existing.canonical && cand.updatedAt > existing.updatedAt)) {
        bestById.set(doc.id, cand);
      }
    }
  }

  return {
    stations: [...bestById.values()].map(c => c.doc),
    complete: failed.length === 0,
    failed,
    scanned: targets.length,
  };
}

/**
 * Remove from the `_stations` mirror every row that is not in `keepIds`, except rows
 * written at or after `snapshotAt` — the moment the list in `keepIds` was read.
 *
 * Without that exception, a station saved from /config while a (slow) sync was running
 * is absent from the list the sync holds and gets deleted right after being added. The
 * condition is part of the delete filter itself, so a row saved between the lookup and
 * the delete is still spared. Rows with no `syncedAt` are left alone.
 *
 * Returns the ids that were matched for removal (for logging).
 */
export async function pruneStaleStations(db: Db, keepIds: string[], snapshotAt: Date): Promise<string[]> {
  const mirror = db.collection('_stations');
  const filter: Filter<Document> = { id: { $nin: keepIds }, syncedAt: { $lt: snapshotAt } };
  const stale = await mirror.find(filter, { projection: { _id: 0, id: 1 } }).toArray();
  if (stale.length === 0) return [];
  await mirror.deleteMany(filter);
  return stale.map(d => String(d.id));
}
