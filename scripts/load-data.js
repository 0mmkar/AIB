#!/usr/bin/env node
/**
 * Loads the delivered BaNCS extracts from Claude_Data/ and builds every monthly pack —
 * the same code path as dropping the files on the Extracts screen.
 *
 *   npm run data:load
 *
 * Stop the server first on Windows (open file handles block the rewrite).
 */
import { loadBundled } from '../server/pipeline.js';

const t0 = Date.now();
const snapshot = await loadBundled({ log: console.log });
if (!snapshot) {
  console.error('No extracts found in Claude_Data/');
  process.exit(1);
}

console.log(`\nExtract date ${snapshot.as_of_label} (${snapshot.as_of_source})`);
console.log(`${snapshot.months.length} reporting periods: ${snapshot.months[0]} → ${snapshot.months[snapshot.months.length - 1]}`);
console.log(`${snapshot.records.toLocaleString()} records read · ${snapshot.measured.toLocaleString()} items measured · ${Date.now() - t0} ms\n`);
for (const r of snapshot.totals) {
  const rate = r.rateCompleted == null ? '   —   ' : `${(r.rateCompleted * 100).toFixed(2)}%`;
  console.log(`  ${r.label.padEnd(14)} ${rate.padStart(7)}  target ${(r.target * 100).toFixed(0)}%  ${r.status.padEnd(7)} ${String(r.met).padStart(5)} met ${String(r.missed).padStart(4)} missed ${String(r.openPastDeadline).padStart(4)} overdue`);
}
