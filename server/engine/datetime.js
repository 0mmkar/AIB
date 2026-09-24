/**
 * Timestamps in the BaNCS extracts are Irish wall-clock times with no zone. They are held
 * as UTC Dates so that the wall-clock reading is exactly what getUTC* returns — nothing is
 * ever converted, and nothing here may use a local-time Date method.
 *
 * Days are 'YYYY-MM-DD' strings: they compare correctly as strings, which keeps every
 * deadline test a plain `<=`.
 */

const DAY_MS = 86400000;
const EXCEL_EPOCH_OFFSET = 25569; // days from 1899-12-30 to 1970-01-01

const DMY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/;

/** Round to the whole second: Excel serials carry float noise below that. */
const toSecond = (ms) => new Date(Math.round(ms / 1000) * 1000);

/**
 * Parse any timestamp shape the extracts use: an xlsx Date cell, an Excel serial number,
 * 'dd/mm/yyyy[ hh:mm[:ss]]' text, or ISO text. Blank and the literal 'nan' (a pandas
 * artefact in WITHDRAWALEXT) are null.
 */
export function parseStamp(v) {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : toSecond(v.getTime());
  if (typeof v === 'number') return Number.isFinite(v) ? toSecond((v - EXCEL_EPOCH_OFFSET) * DAY_MS) : null;

  const s = String(v).trim();
  if (!s || s.toLowerCase() === 'nan') return null;

  let m = s.match(DMY);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)));
  m = s.match(ISO);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)));
  if (/^\d+(\.\d+)?$/.test(s)) return parseStamp(Number(s));
  return null;
}

export const dayOf = (d) => (d ? d.toISOString().slice(0, 10) : null);
export const monthOf = (d) => (d ? d.toISOString().slice(0, 7) : null);
export const isoOf = (d) => (d ? d.toISOString().slice(0, 19) : null);

export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return dayOf(d);
}

export const weekdayOf = (day) => new Date(`${day}T00:00:00Z`).getUTCDay();

export const hoursBetween = (from, to) => (to.getTime() - from.getTime()) / 3600000;
