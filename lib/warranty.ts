/**
 * Commissioning date + warranty period of a station, and the "is it still under
 * warranty?" rule shared by the /config editor, POST /api/stations/save and every
 * page that shows a warranty badge.
 *
 * Both fields are optional. The warranty can only be worked out when BOTH are set;
 * with one or none the status is 'unknown' (shown as "not set").
 *
 * Rule: the warranty ends on  commissioning date + warranty years  (a half year is
 * 6 months; a day that does not exist in the target month is clamped to its last
 * day). The station is still covered through that whole day and is "expired" from
 * the next day. Days are counted on the Asia/Bangkok calendar so the answer is the
 * same for every viewer and for the server.
 */

export const WARRANTY_YEARS_MAX = 20;
/** Years are entered in half-year steps, so the end date is always a whole number of months. */
export const WARRANTY_YEARS_STEP = 0.5;

const MIN_YEAR = 2000;
const MAX_YEAR = 2100;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86_400_000;

interface Ymd { y: number; m: number; d: number }

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const pad = (n: number, width = 2) => String(n).padStart(width, '0');
const toIso = ({ y, m, d }: Ymd) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

/** 'YYYY-MM-DD' → parts, or null when it is not a real calendar date (e.g. 2026-02-30). */
function parseIsoDate(value: string): Ymd | null {
  const match = DATE_RE.exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

const dayNumber = ({ y, m, d }: Ymd) => Math.round(Date.UTC(y, m - 1, d) / DAY_MS);

// ── Validation (editor + save API) ─────────────────────────────────────────────

/** undefined / null / blank mean "not set". Otherwise a real date as YYYY-MM-DD, years 2000–2100. */
export function validateCommissioningDate(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return 'Commissioning date must be text (YYYY-MM-DD)';
  const text = value.trim();
  if (text === '') return null;
  const parts = parseIsoDate(text);
  if (!parts) return 'Commissioning date must be a valid date (YYYY-MM-DD)';
  if (parts.y < MIN_YEAR || parts.y > MAX_YEAR) {
    return `Commissioning date year must be between ${MIN_YEAR} and ${MAX_YEAR}`;
  }
  return null;
}

/** undefined / null mean "not set". Otherwise a number of years: > 0, ≤ 20, in steps of 0.5. */
export function validateWarrantyYears(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Warranty years must be a number';
  if (value <= 0 || value > WARRANTY_YEARS_MAX || (value / WARRANTY_YEARS_STEP) % 1 !== 0) {
    return `Warranty years must be between ${WARRANTY_YEARS_STEP} and ${WARRANTY_YEARS_MAX}, in steps of ${WARRANTY_YEARS_STEP}`;
  }
  return null;
}

export function trimCommissioningDate(value: string | undefined | null): string {
  return value?.trim() ?? '';
}

/** Blank → null (stored explicitly so an edit can clear a saved value). */
export function normalizeWarrantyYears(value: number | undefined | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// ── Calculation ────────────────────────────────────────────────────────────────

/** Today's date on the Asia/Bangkok calendar, as YYYY-MM-DD. */
export function todayInBangkok(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/** Last covered day (YYYY-MM-DD), or null when either value is missing or invalid. */
export function warrantyExpiry(
  commissioningDate: string | undefined | null,
  warrantyYears: number | undefined | null,
): string | null {
  if (validateCommissioningDate(commissioningDate) !== null || validateWarrantyYears(warrantyYears) !== null) return null;
  const start = parseIsoDate(trimCommissioningDate(commissioningDate));
  if (!start || typeof warrantyYears !== 'number') return null;
  const months = start.y * 12 + (start.m - 1) + Math.round(warrantyYears * 12);
  const y = Math.floor(months / 12);
  const m = (months % 12) + 1;
  return toIso({ y, m, d: Math.min(start.d, daysInMonth(y, m)) });
}

export type WarrantyState = 'unknown' | 'active' | 'expired';

export interface WarrantyInfo {
  state: WarrantyState;
  /** Last covered day, YYYY-MM-DD; null when 'unknown'. */
  expiresOn: string | null;
  /** Days from today to `expiresOn` — negative once expired (-1 = ended yesterday); null when 'unknown'. */
  daysLeft: number | null;
}

export function warrantyStatus(
  commissioningDate: string | undefined | null,
  warrantyYears: number | undefined | null,
  today: string = todayInBangkok(),
): WarrantyInfo {
  const expiresOn = warrantyExpiry(commissioningDate, warrantyYears);
  const end = expiresOn ? parseIsoDate(expiresOn) : null;
  const now = parseIsoDate(today);
  if (!expiresOn || !end || !now) return { state: 'unknown', expiresOn: null, daysLeft: null };
  const daysLeft = dayNumber(end) - dayNumber(now);
  return { state: daysLeft < 0 ? 'expired' : 'active', expiresOn, daysLeft };
}

export function isWarrantyExpired(
  commissioningDate: string | undefined | null,
  warrantyYears: number | undefined | null,
  today?: string,
): boolean {
  return warrantyStatus(commissioningDate, warrantyYears, today).state === 'expired';
}

// ── Display ────────────────────────────────────────────────────────────────────

/** '2026-06-15' → '15 Jun 2026' (unrecognised input is returned as is). */
export function formatWarrantyDate(iso: string | undefined | null): string {
  const parts = iso ? parseIsoDate(iso) : null;
  return parts ? `${parts.d} ${MONTHS[parts.m - 1]} ${parts.y}` : (iso ?? '');
}

/** 3 → '3 ปี', 1.5 → '1.5 ปี' */
export function formatWarrantyYears(years: number): string {
  return `${years} ปี`;
}

/** The second half of a status line: 'เมื่อ 15 Jun 2026 · เกินมา 163 วัน' / 'ถึง 10 Sep 2028 · เหลืออีก 655 วัน'. */
export function describeWarranty(info: WarrantyInfo): string {
  if (info.state === 'unknown' || info.expiresOn === null || info.daysLeft === null) return '';
  const date = formatWarrantyDate(info.expiresOn);
  if (info.state === 'expired') return `เมื่อ ${date} · เกินมา ${-info.daysLeft} วัน`;
  return info.daysLeft === 0 ? `ถึง ${date} · วันสุดท้ายของประกัน` : `ถึง ${date} · เหลืออีก ${info.daysLeft} วัน`;
}
