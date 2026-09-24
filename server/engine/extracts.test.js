import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readExtract } from './extracts.js';

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'Claude_Data');
const read = (name) => readExtract(fs.readFileSync(path.join(DATA, name)), name);

const EXPECTED = {
  EBQ_Correspondence_Report_V0_24092026: { kind: 'ebq', headerRow: 1, records: 10000 },
  CANREVEXT_7431728022023_1781224092026: { kind: 'cancellation', headerRow: 2, records: 2000 },
  WITHDRAWALEXT_7431728022023_1781524092026: { kind: 'withdrawal', headerRow: 2, records: 514 },
  WRKFLWEXT_7431728022023_1781324092026: { kind: 'workflow', headerRow: 2, records: 231 },
  WRKFLWEXT_7431728022023_1781424092026: { kind: 'workflow', headerRow: 2, records: 5124 },
};

for (const [base, want] of Object.entries(EXPECTED)) {
  for (const ext of ['csv', 'xlsx']) {
    test(`${base}.${ext} is read as ${want.kind}`, async () => {
      const ex = await read(`${base}.${ext}`);
      assert.equal(ex.kind, want.kind);
      assert.equal(ex.headerRow, want.headerRow);
      assert.equal(ex.records.length, want.records);
    });
  }
}

test('the expected-results workbook is rejected, not mistaken for an extract', async () => {
  // Its '23B UL Step 2' tab carries every WITHDRAWALEXT column; it once replaced the real one.
  await assert.rejects(read('SLA_Expected_Results.xlsx'), /expected-results workbook/);
});

test('a file with unknown columns is rejected', async () => {
  await assert.rejects(readExtract(Buffer.from('a,b,c\n1,2,3\n'), 'other.csv'), /do not match any BaNCS extract/);
});
