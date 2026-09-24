import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Writable state lives under DATA_DIR (default ./data). Point it at a mounted disk when
 * hosting so the imported extracts and generated packs survive restarts.
 *
 *   extracts/            the current BaNCS extract set, as uploaded, plus _index.json
 *   analyses/<month>.json one governance pack per reporting month, rebuilt from the set
 *   snapshot.json        what the current set is: extract date, files, totals, findings
 *
 * The delivered data in Claude_Data/ is read-only and always resolves against the repo.
 */
export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
export const EXTRACTS_DIR = path.join(DATA_DIR, 'extracts');
export const ANALYSES_DIR = path.join(DATA_DIR, 'analyses');
const SNAPSHOT_PATH = path.join(DATA_DIR, 'snapshot.json');
const INDEX_PATH = path.join(EXTRACTS_DIR, '_index.json');

export const BUNDLED_DIR = path.join(ROOT, 'Claude_Data');

const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const isMonthKey = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s));

export function monthLabel(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  return `${MONTH_FULL[m - 1]} ${y}`;
}

export function dayLabel(day) {
  if (!day) return null;
  const [y, m, d] = day.split('-').map(Number);
  return `${d} ${MONTH_FULL[m - 1]} ${y}`;
}

const ensure = (dir) => fs.mkdirSync(dir, { recursive: true });

function readJson(p, fallback) {
  if (!fs.existsSync(p)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(p, value) {
  ensure(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(value) + '\n');
  return value;
}

// --- the extract set ----------------------------------------------------------

export const readExtractIndex = () => readJson(INDEX_PATH, []);
export const writeExtractIndex = (entries) => writeJson(INDEX_PATH, entries);

export function saveExtractFile(id, originalName, buffer) {
  ensure(EXTRACTS_DIR);
  const ext = (originalName.split('.').pop() || 'bin').toLowerCase();
  const stored = `${id}.${ext}`;
  fs.writeFileSync(path.join(EXTRACTS_DIR, stored), buffer);
  return stored;
}

export const readExtractFile = (stored) => fs.readFileSync(path.join(EXTRACTS_DIR, stored));

export function deleteExtractFile(stored) {
  const p = path.join(EXTRACTS_DIR, stored);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

// --- monthly packs --------------------------------------------------------------

const analysisPath = (monthKey) => path.join(ANALYSES_DIR, `${monthKey}.json`);

export const readAnalysis = (monthKey) => readJson(analysisPath(monthKey), null);
export const writeAnalysis = (monthKey, analysis) => writeJson(analysisPath(monthKey), analysis);

/** Reporting months that have a pack, newest first. */
export function listMonths() {
  if (!fs.existsSync(ANALYSES_DIR)) return [];
  return fs
    .readdirSync(ANALYSES_DIR)
    .map((n) => n.replace(/\.json$/, ''))
    .filter(isMonthKey)
    .sort()
    .reverse();
}

/** Packs are derived from the extract set as a whole, so a rebuild replaces all of them. */
export function clearAnalyses() {
  if (!fs.existsSync(ANALYSES_DIR)) return;
  for (const n of fs.readdirSync(ANALYSES_DIR)) {
    if (n.endsWith('.json')) fs.unlinkSync(path.join(ANALYSES_DIR, n));
  }
}

// --- snapshot -------------------------------------------------------------------

export const readSnapshot = () => readJson(SNAPSHOT_PATH, null);
export const writeSnapshot = (snapshot) => writeJson(SNAPSHOT_PATH, snapshot);
export function clearSnapshot() {
  if (fs.existsSync(SNAPSHOT_PATH)) fs.unlinkSync(SNAPSHOT_PATH);
}

// --- delivered data ---------------------------------------------------------------

/**
 * The extracts shipped in Claude_Data/. Each extract is delivered as both .csv and .xlsx
 * with identical content, so only one format is loaded — loading both would count every
 * record twice. The expected-results workbook is reference material, not an extract.
 */
export function listBundledExtracts(ext = 'csv') {
  if (!fs.existsSync(BUNDLED_DIR)) return [];
  return fs
    .readdirSync(BUNDLED_DIR)
    .filter((n) => n.toLowerCase().endsWith(`.${ext}`) && !/^SLA_Expected_Results/i.test(n))
    .map((name) => ({ name, absolute: path.join(BUNDLED_DIR, name) }));
}
