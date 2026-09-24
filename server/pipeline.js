import crypto from 'node:crypto';
import fs from 'node:fs';

import { readExtract } from './engine/extracts.js';
import { evaluate } from './engine/engine.js';
import { OUTCOME } from './engine/outcome.js';
import { slotsOf, EXTRACT_SLOTS } from './slots.js';
import { setFindings, monthFindings, summarise } from './quality.js';
import { missDrivers, isMeasured } from './insights.js';
import {
  monthLabel, dayLabel, readExtractIndex, writeExtractIndex, saveExtractFile, readExtractFile, deleteExtractFile,
  writeAnalysis, clearAnalyses, writeSnapshot, clearSnapshot, listBundledExtracts,
} from './store.js';

/**
 * Extract set → governance packs, independent of HTTP so scripts drive the same code path.
 *
 * The BaNCS extracts are one snapshot spanning many months, so there is no per-month upload:
 * the set is imported once and every month's pack is rebuilt from it. Items land in the
 * month their SLA reports them in (EBQ by receipt month, workflow SLAs by Created month).
 */

/**
 * Add files to the extract set. Each file is identified from its columns; a file that fills
 * a slot already filled supersedes the older one, so the set always holds one current
 * extract per slot — re-uploading the same extract as .csv and .xlsx cannot double-count.
 */
export async function importExtracts(incoming) {
  let index = readExtractIndex();
  const added = [];
  const replaced = [];
  const skipped = [];

  for (const file of incoming) {
    let parsed;
    try {
      parsed = await readExtract(file.buffer, file.originalName);
    } catch (err) {
      skipped.push({ filename: file.originalName, error: err.message });
      continue;
    }
    const covers = slotsOf(parsed);

    for (const old of index.filter((e) => e.covers.some((c) => covers.includes(c)))) {
      deleteExtractFile(old.stored);
      replaced.push(old.filename);
    }
    index = index.filter((e) => !e.covers.some((c) => covers.includes(c)));

    const id = crypto.randomUUID().slice(0, 8);
    const entry = {
      id,
      stored: saveExtractFile(id, file.originalName, file.buffer),
      filename: file.originalName,
      ext: parsed.ext,
      bytes: file.buffer.length,
      uploadedAt: new Date().toISOString(),
      kind: parsed.kind,
      label: parsed.label,
      covers,
      title: parsed.title.join(' · '),
      headerRow: parsed.headerRow,
      columns: parsed.columns.length,
      records: parsed.records.length,
    };
    index.push(entry);
    added.push(entry);
  }

  writeExtractIndex(index);
  return { added, replaced, skipped };
}

export function removeExtract(id) {
  const index = readExtractIndex();
  const entry = index.find((e) => e.id === id);
  if (entry) deleteExtractFile(entry.stored);
  writeExtractIndex(index.filter((e) => e.id !== id));
  return !!entry;
}

/** Which of the five slots the current set fills. */
export function slotStatus(index = readExtractIndex()) {
  return EXTRACT_SLOTS.map((s) => {
    const file = index.find((e) => e.covers.includes(s.id));
    return { ...s, present: !!file, filename: file?.filename ?? null, records: file?.records ?? null };
  });
}

function summaryOf(results, items) {
  const headline = results.filter((r) => !r.parent);
  const n = (o) => items.filter((i) => i.outcome === o).length;
  return {
    total: headline.length,
    pass: headline.filter((r) => r.status === 'PASS').length,
    fail: headline.filter((r) => r.status === 'FAIL').length,
    noData: headline.filter((r) => r.status === 'NO_DATA').length,
    failing: headline.filter((r) => r.status === 'FAIL').map((r) => r.id),
    measured: items.filter(isMeasured).length,
    met: n(OUTCOME.MET),
    missed: n(OUTCOME.MISSED),
    openPastDeadline: n(OUTCOME.OPEN_PAST),
    openNotYetDue: n(OUTCOME.OPEN_DUE),
  };
}

/** Re-read the whole extract set and rebuild every monthly pack plus the snapshot. */
export async function rebuild() {
  const index = readExtractIndex();
  clearAnalyses();
  if (!index.length) {
    clearSnapshot();
    return null;
  }

  const extracts = [];
  for (const e of index) extracts.push(await readExtract(readExtractFile(e.stored), e.filename));

  const result = evaluate(extracts);
  const generatedAt = new Date().toISOString();
  const asOfLabel = dayLabel(result.asOf);
  const sources = index.map(({ stored: _s, ...rest }) => rest);
  const setFlags = setFindings({ sources, mappingRows: result.mappingRows, extracts, schedule: result.schedule })
    .map((f) => ({ ...f, scope: 'set' }));
  const stepTwoMatched = new Set(
    result.items.filter((i) => i.sla === '23B_UL_S2' && i.workflowNumber).map((i) => i.workflowNumber),
  );

  const months = [];
  for (const m of result.monthly) {
    const items = result.items.filter((i) => i.month === m.month);
    const quality = [
      ...monthFindings({
        month: m.month,
        items,
        results: m.results,
        asOf: result.asOf,
        asOfLabel,
        unmapped: result.unmapped23B,
        workflows: result.workflows,
        schedule: result.schedule,
        stepTwoMatched,
      }).map((f) => ({ ...f, scope: 'month' })),
      ...setFlags,
    ];
    const analysis = {
      reporting_month: m.month,
      label: monthLabel(m.month),
      generated_at: generatedAt,
      as_of: result.asOf,
      as_of_label: asOfLabel,
      partial: result.asOf.slice(0, 7) === m.month,
      results: m.results,
      summary: summaryOf(m.results, items),
      quality,
      quality_summary: summarise(quality),
      drivers: missDrivers(items, { minItems: 3, minFailures: 2, limit: 8 }),
      sources,
      items,
    };
    writeAnalysis(m.month, analysis);
    months.push(m.month);
  }

  return writeSnapshot({
    generated_at: generatedAt,
    as_of: result.asOf,
    as_of_label: asOfLabel,
    as_of_source: result.asOfSource,
    sources,
    slots: slotStatus(index),
    quality: setFlags,
    totals: result.totals,
    out_of_scope: result.outOfScope,
    months,
    records: sources.reduce((n, s) => n + s.records, 0),
    measured: result.items.filter(isMeasured).length,
  });
}

/** Import the delivered extracts from Claude_Data/ and build every pack. */
export async function loadBundled({ log = () => {} } = {}) {
  const files = listBundledExtracts('csv');
  if (!files.length) return null;
  const { added, skipped } = await importExtracts(
    files.map((f) => ({ originalName: f.name, buffer: fs.readFileSync(f.absolute) })),
  );
  for (const a of added) log(`  ok ${a.filename} → ${a.label} (${a.records.toLocaleString()} records)`);
  for (const s of skipped) log(`  !  ${s.filename}: ${s.error}`);
  return rebuild();
}
