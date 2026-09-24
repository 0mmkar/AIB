import './env.js'; // must precede any module that reads process.env at import time

import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';

import { loadSchedule } from './engine/engine.js';
import { isFailure } from './insights.js';
import { EXTRACT_SLOTS } from './slots.js';
import { importExtracts, removeExtract, rebuild, loadBundled, slotStatus } from './pipeline.js';
import { buildIntelligence } from './intelligence.js';
import { generateNarrative, narrativeStatus } from './narrative.js';
import { askAssistant, suggestedQuestions } from './assistant.js';
import { ROOT, listMonths, isMonthKey, readAnalysis, readSnapshot, readExtractIndex } from './store.js';

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 12 } });

app.use(express.json());

const PORT = process.env.PORT || 5174;
const fail = (res, code, message) => res.status(code).json({ error: message });

/**
 * Imports and rebuilds rewrite every pack, so they run one at a time. Reads are not
 * serialised — a pack is written whole, and a reader sees either the old or the new one.
 */
let queue = Promise.resolve();
const exclusive = (fn) => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
};

const publicEntry = ({ stored: _s, ...rest }) => rest;

function snapshotSummary() {
  const s = readSnapshot();
  if (!s) return null;
  const { totals: _t, sources: _src, ...rest } = s;
  return { ...rest, sourceCount: s.sources.length };
}

// --- routes -----------------------------------------------------------------

app.get('/api/bootstrap', (req, res) => {
  const months = listMonths().map((m) => {
    const a = readAnalysis(m);
    return {
      month: m,
      label: a?.label ?? m,
      partial: !!a?.partial,
      generatedAt: a?.generated_at ?? null,
      summary: a?.summary ?? null,
      qualityFlags: a?.quality_summary ?? null,
    };
  });
  res.json({
    months,
    snapshot: snapshotSummary(),
    slas: loadSchedule().slas,
    slots: EXTRACT_SLOTS,
  });
});

app.get('/api/extracts', (req, res) => {
  res.json({ extracts: readExtractIndex().map(publicEntry), slots: slotStatus(), snapshot: snapshotSummary() });
});

app.post('/api/extracts', upload.array('files', 12), async (req, res) => {
  if (!req.files?.length) return fail(res, 400, 'No files received');
  const incoming = req.files.map((f) => ({ originalName: f.originalname, buffer: f.buffer }));
  try {
    const out = await exclusive(async () => {
      const result = await importExtracts(incoming);
      const snapshot = result.added.length ? await rebuild() : readSnapshot();
      return { ...result, added: result.added.map(publicEntry), rebuilt: result.added.length > 0, snapshot: !!snapshot };
    });
    res.json(out);
  } catch (err) {
    fail(res, 500, err.message);
  }
});

app.delete('/api/extracts/:id', async (req, res) => {
  try {
    const removed = await exclusive(async () => {
      const ok = removeExtract(req.params.id);
      if (ok) await rebuild();
      return ok;
    });
    if (!removed) return fail(res, 404, 'Extract not found');
    res.json({ ok: true });
  } catch (err) {
    fail(res, 500, err.message);
  }
});

app.post('/api/extracts/rebuild', async (req, res) => {
  try {
    const snapshot = await exclusive(() => rebuild());
    if (!snapshot) return fail(res, 400, 'No extracts loaded');
    res.json({ ok: true, months: snapshot.months.length });
  } catch (err) {
    fail(res, 500, err.message);
  }
});

/** Reload the delivered extracts from Claude_Data/ (they supersede same-slot uploads). */
app.post('/api/extracts/bundled', async (req, res) => {
  try {
    const snapshot = await exclusive(() => loadBundled());
    if (!snapshot) return fail(res, 404, 'No delivered extracts found in Claude_Data/');
    res.json({ ok: true, months: snapshot.months.length });
  } catch (err) {
    fail(res, 500, err.message);
  }
});

/** One month's pack. Carries its failures (missed + overdue) but not every measured item. */
app.get('/api/analysis/:month', (req, res) => {
  const { month } = req.params;
  if (!isMonthKey(month)) return fail(res, 400, 'Invalid reporting month');
  const a = readAnalysis(month);
  if (!a) return fail(res, 404, 'No pack for this period');
  const { items, ...rest } = a;
  res.json({ ...rest, exceptions: items.filter(isFailure), itemCount: items.length });
});

/** Item-level drill-down for a month, optionally narrowed to one SLA and/or outcome. */
app.get('/api/items/:month', (req, res) => {
  const { month } = req.params;
  if (!isMonthKey(month)) return fail(res, 400, 'Invalid reporting month');
  const a = readAnalysis(month);
  if (!a) return fail(res, 404, 'No pack for this period');
  const sla = req.query.sla ? String(req.query.sla) : null;
  const outcome = req.query.outcome ? String(req.query.outcome) : null;
  const def = sla ? loadSchedule().slas.find((s) => s.id === sla) : null;
  const slaIds = def?.parts ?? (sla ? [sla] : null);
  const items = a.items.filter((i) => (!slaIds || slaIds.includes(i.sla)) && (!outcome || i.outcome === outcome));
  res.json({ month, sla, outcome, count: items.length, items });
});

/**
 * Operational intelligence over the whole history. `scope` is 'all' or a month key; a month
 * narrows the window to that month and everything before it.
 */
app.get('/api/intelligence', async (req, res) => {
  const scope = req.query.scope && req.query.scope !== 'all' ? String(req.query.scope) : 'all';
  if (scope !== 'all' && !isMonthKey(scope)) return fail(res, 400, 'Invalid scope');
  try {
    const intel = buildIntelligence({ scope });
    if (intel.empty) return res.json({ ...intel, narrative: null, narrativeStatus: narrativeStatus() });
    const narrative = await generateNarrative(intel, { refresh: req.query.refresh === '1' });
    res.json({ ...intel, narrative, narrativeStatus: narrativeStatus(), suggestedQuestions: suggestedQuestions(intel) });
  } catch (err) {
    fail(res, 500, err.message);
  }
});

/** Grounded, single-turn Q&A over one report's computed outputs. */
app.post('/api/intelligence/ask', async (req, res) => {
  const { question, scope: rawScope } = req.body ?? {};
  const scope = rawScope && rawScope !== 'all' ? String(rawScope) : 'all';
  if (scope !== 'all' && !isMonthKey(scope)) return fail(res, 400, 'Invalid scope');
  if (!String(question ?? '').trim()) return fail(res, 400, 'Ask a question about the report');
  if (String(question).length > 400) return fail(res, 400, 'Question is too long');
  try {
    const intel = buildIntelligence({ scope });
    if (intel.empty) return fail(res, 400, 'No history to answer from yet');
    res.json(await askAssistant(intel, question));
  } catch (err) {
    fail(res, 500, err.message);
  }
});

// Serve the built frontend when one exists, so everything can run from a single process.
const DIST = path.join(ROOT, 'dist');
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(DIST, 'index.html')));
}

/**
 * With no extract set loaded — a fresh clone, or a host with an ephemeral disk — load the
 * delivered extracts from Claude_Data/ so the dashboard is never empty.
 * SKIP_BOOTSTRAP_DATA=1 starts genuinely empty instead.
 */
async function ensureData() {
  if (process.env.SKIP_BOOTSTRAP_DATA === '1') return;
  if (readSnapshot() && listMonths().length) return;
  try {
    const snapshot = await exclusive(() => (readExtractIndex().length ? rebuild() : loadBundled()));
    if (snapshot) console.log(`loaded extract set as of ${snapshot.as_of} — ${snapshot.months.length} reporting periods`);
  } catch (err) {
    console.warn(`could not load the extract set: ${err.message}`);
  }
}

app.listen(PORT, async () => {
  console.log(`AIB Life SLA governance API  ->  http://localhost:${PORT}`);
  await ensureData();
});
