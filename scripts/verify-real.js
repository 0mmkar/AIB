import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

import { readExtract } from '../server/engine/extracts.js';
import { evaluate } from '../server/engine/engine.js';
import { parseStamp, dayOf, monthOf } from '../server/engine/datetime.js';

/**
 * Acceptance test for the SLA engine: run it over the extracts in Claude_Data and compare
 * with SLA_Expected_Results.xlsx — every row of every SLA tab, and every month of the
 * 'Monthly summary'. Runs the .csv set and the .xlsx set separately, so the two formats are
 * proven to agree. Exits non-zero on any difference.
 *
 *   node scripts/verify-real.js [dataDir] [--show=N]
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const DATA = path.resolve(args.find((a) => !a.startsWith('--')) ?? path.join(ROOT, 'Claude_Data'));
const SHOW = Number(args.find((a) => a.startsWith('--show='))?.split('=')[1] ?? 5);
const ORACLE = path.join(DATA, 'SLA_Expected_Results.xlsx');

// ------------------------------------------------------------------ oracle

const plain = (v) => {
  if (v == null) return null;
  if (typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) return plain(v.result);
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.text != null) return v.text;
    if (v.error) return null;
  }
  return v;
};

async function readTab(wb, name) {
  const ws = wb.getWorksheet(name);
  if (!ws) throw new Error(`Oracle has no '${name}' tab`);
  const headers = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => (headers[i] = String(plain(c.value) ?? '').trim()));
  const rows = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const rec = {};
    headers.forEach((h, i) => h && (rec[h] = plain(row.getCell(i).value)));
    rows.push(rec);
  });
  return rows;
}

const SUMMARY_GROUPS = {
  '23A': '23A',
  '23B NUL': '23B_NUL',
  '23B UL Step 1': '23B_UL_S1',
  '23B UL Step 2': '23B_UL_S2',
  '23B UL Step 3': '23B_UL_S3',
  '23B UL Overall (Steps 1–3)': '23B_UL',
  '23C': '23C',
  '23E': '23E',
};

async function readSummary(wb) {
  const ws = wb.getWorksheet('Monthly summary');
  let groupRow = null;
  ws.eachRow((row, n) => {
    if (String(plain(row.getCell(1).value) ?? '').trim() === 'Month') groupRow = n - 1;
  });
  const groups = [];
  // Group labels are merged across six columns and ExcelJS repeats the label on every
  // merged cell — the group starts at its first occurrence.
  ws.getRow(groupRow).eachCell((c, col) => {
    const id = SUMMARY_GROUPS[String(plain(c.value) ?? '').trim()];
    if (id && !groups.some((g) => g.id === id)) groups.push({ id, col });
  });
  const out = new Map();
  ws.eachRow((row, n) => {
    if (n <= groupRow + 1) return;
    const month = String(plain(row.getCell(1).value) ?? '').trim();
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    for (const g of groups) {
      // ExcelJS drops a formula's cached result when it is falsy (0 or ""), leaving just
      // { formula }. Such a cell therefore holds 0 (counts) or "" (verdict).
      const at = (o) => {
        const v = row.getCell(g.col + o).value;
        if (v && typeof v === 'object' && 'formula' in v && !('result' in v)) return null;
        return plain(v);
      };
      out.set(`${month}|${g.id}`, {
        met: Number(at(0) ?? 0),
        missed: Number(at(1) ?? 0),
        openPastDeadline: Number(at(2) ?? 0),
        verdict: at(5) || null,
      });
    }
  });
  return out;
}

// ------------------------------------------------------------------ compare

const asDay = (v) => (v == null || v === '' ? null : dayOf(parseStamp(v)));
const asMonth = (v) => (v == null || v === '' ? null : /^\d{4}-\d{2}$/.test(String(v)) ? String(v) : monthOf(parseStamp(v)));
const asId = (v) => (v == null || v === '' ? null : typeof v === 'number' ? String(Math.round(v)) : String(v).trim());
const yn = (b) => (b == null ? null : b ? 'Y' : 'N');

const SLA_LABEL = { '23B_NUL': '23B NUL', '23B_UL_S1': '23B UL Step 1' };

/**
 * Per-tab comparison spec: which oracle column identifies the row, which of our items it
 * joins to, and the fields to compare (oracle value, ours) — a blank oracle cell is not
 * compared.
 */
const TABS = [
  {
    tab: '23B EBQ',
    slas: ['23B_NUL', '23B_UL_S1'],
    oracleKey: (r) => asId(r['EBQ Row']),
    ourKey: (i) => String(i.sourceRow),
    fields: [
      ['SLA', (r) => r['SLA'], (i) => (i ? SLA_LABEL[i.sla] : 'Out of scope')],
      ['Receipt Month', (r) => asMonth(r['Receipt Month']), (i) => i?.month ?? null],
      ['Clock Start', (r) => asDay(r['Clock Start']), (i) => i?.clockStart ?? null],
      ['Deadline', (r) => asDay(r['Deadline']), (i) => i?.deadline ?? null],
      ['Business Days Taken', (r) => (r['Business Days Taken'] == null || r['Business Days Taken'] === '' ? null : Number(r['Business Days Taken'])), (i) => i?.businessDaysTaken ?? null],
    ],
  },
  {
    tab: '23A',
    slas: ['23A'],
    oracleKey: (r) => asId(r['Workflow Number']),
    ourKey: (i) => i.key,
    fields: [
      ['Created Month', (r) => asMonth(r['Created Month']), (i) => i?.month ?? null],
      ['Before 3pm', (r) => r['Before 3pm'] ?? null, (i) => yn(i?.beforeCutoff)],
      ['Clock Start', (r) => asDay(r['Clock Start']), (i) => i?.clockStart ?? null],
      ['Deadline', (r) => asDay(r['Deadline']), (i) => i?.deadline ?? null],
    ],
  },
  {
    tab: '23B UL Step 2',
    slas: ['23B_UL_S2'],
    oracleKey: (r) => asId(r['WITHDRAWALEXT Row']),
    ourKey: (i) => i.key,
    fields: [
      ['Matched Workflow Number', (r) => asId(r['Matched Workflow Number']), (i) => i?.workflowNumber ?? null],
      ['Created Month', (r) => asMonth(r['Created Month']), (i) => i?.month ?? null],
      ['Before 3pm', (r) => r['Before 3pm'] ?? null, (i) => yn(i?.beforeCutoff)],
      ['Deadline', (r) => asDay(r['Deadline']), (i) => i?.deadline ?? null],
    ],
  },
  {
    tab: '23B UL Step 3',
    slas: ['23B_UL_S3'],
    oracleKey: (r) => asId(r['Workflow Number']),
    ourKey: (i) => i.key,
    fields: [
      ['Created Month', (r) => asMonth(r['Created Month']), (i) => i?.month ?? null],
      ['Before 3pm', (r) => r['Before 3pm'] ?? null, (i) => yn(i?.beforeCutoff)],
      ['Clock Start', (r) => asDay(r['Clock Start']), (i) => i?.clockStart ?? null],
      ['Deadline', (r) => asDay(r['Deadline']), (i) => i?.deadline ?? null],
    ],
  },
  {
    tab: '23C',
    slas: ['23C'],
    oracleKey: (r) => asId(r['CANREVEXT Row']),
    ourKey: (i) => i.key,
    fields: [
      ['In 23C Scope', (r) => r['In 23C Scope'] ?? null, (i) => (i ? 'Y' : 'N')],
      ['Matched Workflow Number', (r) => asId(r['Matched Workflow Number']), (i) => i?.workflowNumber ?? null],
      ['Created Month', (r) => asMonth(r['Created Month']), (i) => i?.month ?? null],
      ['Elapsed Hours', (r) => (r['Elapsed Hours'] == null || r['Elapsed Hours'] === '' ? null : Math.round(Number(r['Elapsed Hours']) * 100) / 100), (i) => (i?.elapsedHours == null ? null : Math.round(i.elapsedHours * 100) / 100)],
    ],
  },
  {
    tab: '23E',
    slas: ['23E'],
    oracleKey: (r) => asId(r['Workflow Number']),
    ourKey: (i) => i.key,
    fields: [
      ['In 23E Scope', (r) => r['In 23E Scope'] ?? null, (i) => (i ? 'Y' : 'N')],
      ['Created Month', (r) => asMonth(r['Created Month']), (i) => i?.month ?? null],
      ['Clock Start', (r) => asDay(r['Clock Start']), (i) => i?.clockStart ?? null],
      ['Deadline', (r) => asDay(r['Deadline']), (i) => i?.deadline ?? null],
    ],
  },
];

function compareTab(spec, oracleRows, items) {
  const ours = new Map(items.filter((i) => spec.slas.includes(i.sla)).map((i) => [spec.ourKey(i), i]));
  const diffs = [];
  const seen = new Set();

  for (const r of oracleRows) {
    const key = spec.oracleKey(r);
    if (key == null) continue;
    seen.add(key);
    const mine = ours.get(key) ?? null;
    const expected = String(r['Expected Result'] ?? '').trim();
    const got = mine?.outcome ?? 'OUT OF SCOPE';
    if (expected !== got) diffs.push({ key, field: 'Expected Result', expected, got, note: r['Note'] ?? r['Mapping Quirk'] ?? '' });
    // Out-of-scope rows carry informational columns (month, candidate workflow) that the
    // engine has no reason to produce — only the scope verdict itself is compared.
    if (expected === 'OUT OF SCOPE') continue;
    for (const [field, oracleVal, ourVal] of spec.fields) {
      const e = oracleVal(r);
      if (e == null || e === '') continue;
      const g = ourVal(mine);
      if (String(e) !== String(g)) diffs.push({ key, field, expected: e, got: g, note: r['Note'] ?? '' });
    }
  }
  for (const [key, i] of ours) {
    if (!seen.has(key)) diffs.push({ key, field: 'row', expected: '(not in oracle)', got: i.outcome, note: 'engine produced an item the oracle does not list' });
  }
  return { rows: oracleRows.length, diffs };
}

function compareSummary(expected, monthly) {
  const diffs = [];
  const ours = new Map();
  for (const m of monthly) for (const r of m.results) ours.set(`${m.month}|${r.id}`, r);
  for (const [key, e] of expected) {
    const g = ours.get(key) ?? { met: 0, missed: 0, openPastDeadline: 0, status: 'NO_DATA' };
    for (const f of ['met', 'missed', 'openPastDeadline']) {
      if (e[f] !== g[f]) diffs.push({ key, field: f, expected: e[f], got: g[f] });
    }
    const verdict = g.status === 'NO_DATA' ? null : g.status;
    if ((e.verdict ?? null) !== verdict) diffs.push({ key, field: 'vs Target', expected: e.verdict, got: verdict });
  }
  return { rows: expected.size, diffs };
}

// ------------------------------------------------------------------ run

async function loadSet(ext) {
  const files = fs
    .readdirSync(DATA)
    .filter((f) => f.toLowerCase().endsWith(`.${ext}`) && !/^SLA_Expected_Results/i.test(f));
  const extracts = [];
  for (const f of files) extracts.push({ ...(await readExtract(fs.readFileSync(path.join(DATA, f)), f)), file: f });
  return extracts;
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(ORACLE);
const oracleTabs = Object.fromEntries(await Promise.all(TABS.map(async (t) => [t.tab, await readTab(wb, t.tab)])));
const oracleSummary = await readSummary(wb);

let failed = false;
for (const ext of ['csv', 'xlsx']) {
  const t0 = Date.now();
  const extracts = await loadSet(ext);
  const result = evaluate(extracts);
  const ms = Date.now() - t0;

  console.log(`\n=== ${ext.toUpperCase()} set · ${extracts.map((e) => `${e.kind}(${e.records.length})`).join(' ')} · as of ${result.asOf} · ${ms} ms`);
  console.log(`    as-of source: ${result.asOfSource}`);

  const checks = [
    ...TABS.map((t) => ({ name: `tab ${t.tab}`, ...compareTab(t, oracleTabs[t.tab], result.items) })),
    { name: 'Monthly summary', ...compareSummary(oracleSummary, result.monthly) },
  ];
  for (const c of checks) {
    const ok = c.diffs.length === 0;
    if (!ok) failed = true;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(22)} ${String(c.rows).padStart(6)} rows  ${c.diffs.length} diffs`);
    for (const d of c.diffs.slice(0, SHOW)) {
      console.log(`          ${d.key} · ${d.field}: expected ${JSON.stringify(d.expected)} got ${JSON.stringify(d.got)}${d.note ? `  [${d.note}]` : ''}`);
    }
    if (c.diffs.length > SHOW) {
      const byField = {};
      for (const d of c.diffs) byField[d.field] = (byField[d.field] || 0) + 1;
      console.log(`          ... by field: ${JSON.stringify(byField)}`);
    }
  }
}

console.log(failed ? '\nVERIFY FAILED' : '\nVERIFY PASSED — engine reproduces SLA_Expected_Results.xlsx exactly');
process.exit(failed ? 1 : 0);
