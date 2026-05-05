/**
 * Format ISO-like timestamp WITHOUT timezone conversion.
 * MQTT data uses local timestamps (e.g. "2026-04-26T13:26:59.929284") that should
 * display exactly as-is, not adjusted by browser timezone.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Parse "2026-04-26T13:26:59.929284" or "2026-04-26T13:26:59Z" → component parts (no TZ shift) */
function parseRaw(iso: string): { y: number; mo: number; d: number; h: number; mi: number; s: number } | null {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return {
    y:  Number(m[1]),
    mo: Number(m[2]),
    d:  Number(m[3]),
    h:  Number(m[4]),
    mi: Number(m[5]),
    s:  Number(m[6]),
  };
}

/** "26 Apr 2026, 20:14:17" — no timezone shift */
export function fmtTs(iso: string | null | undefined): string {
  if (!iso) return '—';
  const p = parseRaw(iso);
  if (!p) return 'Invalid Date';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(p.d)} ${MONTHS[p.mo - 1]} ${p.y}, ${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`;
}

/** "13:26:59" — time only */
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const p = parseRaw(iso);
  if (!p) return '—';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`;
}

/** "26 Apr 2026" — date only */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const p = parseRaw(iso);
  if (!p) return '—';
  return `${p.d.toString().padStart(2, '0')} ${MONTHS[p.mo - 1]} ${p.y}`;
}

/**
 * "5m ago", "2h ago", "just now" — relative time from now (using browser clock).
 * Compares raw parsed time against `new Date()` interpreted in same local zone.
 */
export function timeSince(iso: string | null | undefined): string {
  if (!iso) return '—';
  const p = parseRaw(iso);
  if (!p) return '—';

  // Build a Date assuming the parsed time is in the SAME local timezone as the browser
  const t = new Date(p.y, p.mo - 1, p.d, p.h, p.mi, p.s).getTime();
  const diff = Date.now() - t;
  const mins = Math.floor(diff / 60_000);
  const hrs  = Math.floor(diff / 3_600_000);
  if (diff < 0)  return 'just now';
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
