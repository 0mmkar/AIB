import ExcelJS from 'exceljs';

/**
 * Reads the BaNCS extracts (.csv or .xlsx) into plain records.
 *
 * Each extract type is recognised by the columns it carries. The CANREVEXT, WITHDRAWALEXT
 * and WRKFLWEXT exports put a 'TCS BaNCS Insurance' title on row 1 and the header on row 2;
 * the EBQ report has its header on row 1. Records keep their real spreadsheet row number
 * (`_row`), which is how SLA_Expected_Results.xlsx refers to them.
 *
 * Field names are normalised (lower case, single spaces) because the same column is cased
 * differently across extracts — 'Date and Time of Last Status' vs 'Date and Time Of last status'.
 */

export const EXTRACT_KINDS = [
  {
    kind: 'ebq',
    label: 'EBQ Correspondence Report',
    feeds: ['23B_NUL', '23B_UL_S1'],
    headers: ['product', 'policy number', 'transaction reference', 'transaction type', 'status', 'transaction start date', 'transaction merged date'],
  },
  {
    kind: 'cancellation',
    label: 'Cancellation Tracker (CANREVEXT)',
    feeds: ['23C'],
    headers: ['policy number', 'product name', 'cancellation reason', 'date and time of last status'],
  },
  {
    kind: 'withdrawal',
    label: 'Withdrawal extract (WITHDRAWALEXT)',
    feeds: ['23B_UL_S2'],
    headers: ['policy number', 'product name', 'request id', 'transaction status', 'transaction type', 'date and time of last status'],
  },
  {
    kind: 'workflow',
    label: 'Workflow extract (WRKFLWEXT)',
    feeds: ['23A', '23B_UL_S2', '23B_UL_S3', '23C', '23E'],
    headers: ['workflow number', 'workflow type', 'reference number', 'product name', 'created date', 'status', 'close date', 'workflow description'],
  },
];

export const kindById = (kind) => EXTRACT_KINDS.find((k) => k.kind === kind);

const HEADER_SCAN_ROWS = 10;

export const fieldName = (h) => String(h ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** An xlsx cell as a primitive: Date, number, string or null. */
function cellValue(v) {
  if (v == null) return null;
  if (v instanceof Date || typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return cellValue(v.result);
    if (v.text != null) return String(v.text);
    if (v.error) return null;
  }
  return String(v);
}

/** RFC 4180 CSV: quoted fields may hold commas, doubled quotes and line breaks. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else cur += ch;
  }
  if (cur !== '' || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

/** Sheet grid as [{ row: <1-based spreadsheet row>, cells: [...] }]. */
async function readGrid(buffer, ext) {
  if (ext === 'csv') {
    return parseCsv(buffer.toString('utf8')).map((cells, i) => ({ row: i + 1, cells }));
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  // The extracts are single-sheet; take the first sheet that carries a recognisable header.
  const grids = wb.worksheets.map((ws) => {
    const out = [];
    ws.eachRow({ includeEmpty: false }, (r, rowNumber) => {
      const vals = Array.isArray(r.values) ? r.values.slice(1).map(cellValue) : [];
      out.push({ row: rowNumber, cells: vals });
    });
    return out;
  });
  return grids.find((g) => locateHeader(g)) ?? grids[0] ?? [];
}

function locateHeader(grid) {
  for (const line of grid.slice(0, HEADER_SCAN_ROWS)) {
    const names = new Set(line.cells.map(fieldName));
    const match = EXTRACT_KINDS.find((k) => k.headers.every((h) => names.has(h)));
    if (match) return { line, kind: match };
  }
  return null;
}

const isBlank = (v) => v == null || (typeof v === 'string' && v.trim() === '');

/**
 * Parse one uploaded extract. Throws when the columns match no known extract type, so a
 * stray file is rejected at the door rather than silently scored as something it is not.
 */
export async function readExtract(buffer, filename) {
  const ext = (String(filename).split('.').pop() || '').toLowerCase();
  if (!['csv', 'xlsx'].includes(ext)) throw new Error(`Unsupported file type: .${ext} (expected .csv or .xlsx)`);

  const grid = await readGrid(buffer, ext);
  const found = locateHeader(grid);
  if (!found) {
    throw new Error('Columns do not match any BaNCS extract (EBQ, CANREVEXT, WITHDRAWALEXT or WRKFLWEXT)');
  }

  const fields = found.line.cells.map(fieldName);
  const title = grid
    .filter((g) => g.row < found.line.row)
    .flatMap((g) => g.cells)
    .filter((c) => !isBlank(c))
    .map((c) => String(c).trim());

  const records = [];
  for (const line of grid) {
    if (line.row <= found.line.row) continue;
    if (line.cells.every(isBlank)) continue;
    const rec = { _row: line.row };
    fields.forEach((f, i) => {
      if (f) rec[f] = line.cells[i] ?? null;
    });
    records.push(rec);
  }

  return {
    kind: found.kind.kind,
    label: found.kind.label,
    ext,
    title,
    headerRow: found.line.row,
    columns: found.line.cells.map((c) => String(c ?? '').trim()).filter(Boolean),
    records,
  };
}

/** Trimmed text of a field, '' when blank. */
export const text = (rec, field) => (isBlank(rec[field]) ? '' : String(rec[field]).trim());

/** Identifier fields arrive as numbers from xlsx and strings from csv — compare as text. */
export const idOf = (rec, field) => {
  const v = rec[field];
  if (isBlank(v)) return '';
  return typeof v === 'number' ? String(Math.round(v)) : String(v).trim();
};
