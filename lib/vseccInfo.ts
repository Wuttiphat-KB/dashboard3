/**
 * vSECC "information" (GET <vSECC>/api/information) → what the dashboard stores and shows.
 * Pure helpers, no I/O, so they can be unit-tested (tests/vseccInfo.test.ts).
 *
 * Confirmed on a real vSECC: the answer is a JSON object with `firmwareVersion`, plus serial number,
 * product number, model, license and uptime. Only `firmwareVersion` is a confirmed key name, so every
 * other top-level field is kept exactly as the device reports it and the panel shows them as-is.
 */

export type InfoValue = string | number | boolean | null;
export type InfoFields = Record<string, InfoValue>;

const MAX_FIELDS = 40;
const MAX_TEXT = 300;

/** "Firmware_Version" / "firmware-version" / "firmwareVersion" → "firmwareversion". */
const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Top-level fields of the answer; nested objects/arrays become short JSON text. null when it is not a JSON object. */
export function sanitizeInformation(json: unknown): InfoFields | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const out: InfoFields = {};
  for (const [k, v] of Object.entries(json as Record<string, unknown>).slice(0, MAX_FIELDS)) {
    if (!k || k.length > 100) continue;
    if (v === null || typeof v === 'boolean' || typeof v === 'number') out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, MAX_TEXT);
    else {
      try { out[k] = JSON.stringify(v).slice(0, MAX_TEXT); } catch { /* unserialisable → skip */ }
    }
  }
  return Object.keys(out).length ? out : null;
}

/** First non-empty field whose normalised name equals one of `names` (earlier names win). */
function pick(fields: InfoFields | null | undefined, names: string[]): string | null {
  if (!fields) return null;
  for (const name of names) {
    for (const [k, v] of Object.entries(fields)) {
      if (norm(k) === name && v !== null && v !== '') return String(v);
    }
  }
  return null;
}

export const firmwareOf = (fields: InfoFields | null | undefined) => pick(fields, ['firmwareversion', 'fwversion', 'firmware']);
export const modelOf = (fields: InfoFields | null | undefined) => pick(fields, ['model', 'modelname']);

export interface InfoSource { info?: InfoFields | null; infoAt?: string | null; infoError?: string | null }

export interface InfoView {
  firmwareVersion: string | null;
  model: string | null;
  infoAt: string | null;
  /** Admins only: every field the vSECC reported (serial number, product number, license, uptime …). */
  info?: InfoFields;
  /** Admins only: why the last read failed (raw errors can include addresses). */
  infoError?: string | null;
}

/** What the API sends to the browser: customers get firmware + model only, admins get everything. */
export function infoView(src: InfoSource, isAdmin: boolean): InfoView {
  const view: InfoView = { firmwareVersion: firmwareOf(src.info), model: modelOf(src.info), infoAt: src.infoAt ?? null };
  return isAdmin ? { ...view, info: src.info ?? undefined, infoError: src.infoError ?? null } : view;
}
