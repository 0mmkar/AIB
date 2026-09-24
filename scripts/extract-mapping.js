import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';

/**
 * Copies the 'Mapping for 23B' tab of the SLA workbook into config/mapping-23b.json.
 *
 * Rows are copied verbatim — duplicate pairs, the 'Ul' code and trailing spaces included —
 * so the config stays a faithful record of the source. The engine normalises on read.
 *
 *   node scripts/extract-mapping.js [path/to/SLA_Expected_Results.xlsx]
 */
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const src = path.resolve(process.argv[2] ?? path.join(ROOT, 'Claude_Data', 'SLA_Expected_Results.xlsx'));
const out = path.join(ROOT, 'config', 'mapping-23b.json');

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(src);
const ws = wb.getWorksheet('Mapping for 23B');
if (!ws) throw new Error(`No 'Mapping for 23B' tab in ${src}`);

const str = (v) => (v == null ? '' : typeof v === 'object' && v.richText ? v.richText.map((t) => t.text).join('') : String(v));
const rows = [];
ws.eachRow((row, n) => {
  if (n === 1) return;
  // row.values is truncated after the last filled cell, so read the five columns by index.
  const [product, transaction, statement, code, dependency] = [1, 2, 3, 4, 5].map((c) => str(row.getCell(c).value));
  if (!product && !transaction) return;
  rows.push({ product, transaction, statement, code, dependency: dependency.trim() || null });
});

fs.writeFileSync(
  out,
  JSON.stringify(
    {
      $comment: `Verbatim copy of 'Mapping for 23B' from ${path.basename(src)}. Regenerate with: node scripts/extract-mapping.js`,
      rows,
    },
    null,
    2,
  ) + '\n',
);
console.log(`wrote ${rows.length} mapping rows -> ${path.relative(ROOT, out)}`);
