import { validateCommissioningDate, validateWarrantyYears } from '../lib/warranty';

/** One row of warranty-source.json in outputs/warranty-mapping-20261125 (made from the FLEXXFAST Running no. sheet). */
export interface WarrantySourceRow {
  sheetRow: number;
  sheetName: string;
  stationId: string | null;
  commissioningDate: string | null; // YYYY-MM-DD
  warrantyYears: number | null;     // only when the sheet states it
  confidence: 'high' | 'medium' | null;
  action: 'apply' | 'hold' | 'unmatched';
  note?: string;
}

/** The fields we read from the live `Station._stations` mirror. */
export interface LiveStation {
  id: string;
  name: string;
  displayName?: string;
  commissioningDate?: string | null;
  warrantyYears?: number | null;
}

export interface WarrantyFields { commissioningDate?: string; warrantyYears?: number }

export type PlanStatus =
  | 'update'            // at least one field will be written
  | 'unchanged'         // the station already has exactly these values
  | 'conflict'          // the station has a different value and --overwrite was not given
  | 'station-missing'   // the id is not in the live database
  | 'invalid'           // a value would be rejected by /api/stations/save
  | 'skipped-medium'    // --only-high and this match is medium confidence
  | 'duplicate-source'; // two sheet rows point at the same station

export interface PlanItem {
  sheetRow: number;
  sheetName: string;
  stationId: string;
  name: string;
  confidence: 'high' | 'medium' | null;
  status: PlanStatus;
  /** Fields that will be written (only the ones that are blank today, or all differing ones with --overwrite). */
  changes: WarrantyFields;
  /** Fields where the station already holds a different value. */
  conflicts: Array<{ field: keyof WarrantyFields; current: unknown; sheet: unknown }>;
  error?: string;
}

export interface PlanOptions { onlyHigh?: boolean; overwrite?: boolean }

const blank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

export function buildWarrantyPlan(source: WarrantySourceRow[], stations: LiveStation[], opts: PlanOptions = {}) {
  const live = new Map(stations.map(station => [station.id, station]));
  const applyRows = source.filter(row => row.action === 'apply' && row.stationId);

  const perStation = new Map<string, number>();
  for (const row of applyRows) perStation.set(row.stationId!, (perStation.get(row.stationId!) || 0) + 1);

  const items: PlanItem[] = applyRows.map(row => {
    const stationId = row.stationId!;
    const station = live.get(stationId);
    const item: PlanItem = {
      sheetRow: row.sheetRow, sheetName: row.sheetName, stationId, name: station?.name ?? '',
      confidence: row.confidence, status: 'unchanged', changes: {}, conflicts: [],
    };
    if ((perStation.get(stationId) || 0) > 1) return { ...item, status: 'duplicate-source', error: 'More than one sheet row targets this station' };
    if (!station) return { ...item, status: 'station-missing', error: 'Station id not found in the live database' };
    if (opts.onlyHigh && row.confidence !== 'high') return { ...item, status: 'skipped-medium' };

    const error = validateCommissioningDate(row.commissioningDate) || validateWarrantyYears(row.warrantyYears);
    if (error) return { ...item, status: 'invalid', error };

    const wanted: WarrantyFields = {};
    if (!blank(row.commissioningDate)) wanted.commissioningDate = row.commissioningDate!.trim();
    if (typeof row.warrantyYears === 'number') wanted.warrantyYears = row.warrantyYears;

    for (const field of ['commissioningDate', 'warrantyYears'] as const) {
      if (wanted[field] === undefined) continue;          // the sheet has nothing for this field
      const current = station[field];
      if (blank(current)) (item.changes as Record<string, unknown>)[field] = wanted[field];
      else if (current === wanted[field]) continue;       // already correct
      else if (opts.overwrite) (item.changes as Record<string, unknown>)[field] = wanted[field];
      else item.conflicts.push({ field, current, sheet: wanted[field] });
    }
    item.status = Object.keys(item.changes).length ? 'update' : item.conflicts.length ? 'conflict' : 'unchanged';
    return item;
  });

  const count = (status: PlanStatus) => items.filter(item => item.status === status).length;
  const counts = Object.fromEntries((['update', 'unchanged', 'conflict', 'station-missing', 'invalid', 'skipped-medium', 'duplicate-source'] as PlanStatus[])
    .map(status => [status, count(status)]));
  return {
    sourceRows: source.length,
    notApplied: { hold: source.filter(row => row.action === 'hold').length, unmatched: source.filter(row => row.action === 'unmatched').length },
    liveStations: stations.length,
    counts,
    // Problems that make --apply refuse to run (conflicts are reported but never block: they are simply left alone).
    blocking: items.filter(item => ['station-missing', 'invalid', 'duplicate-source'].includes(item.status)),
    items,
  };
}

export type WarrantyPlan = ReturnType<typeof buildWarrantyPlan>;
