import test from 'node:test';
import assert from 'node:assert/strict';

import { contradictedClaims, unsupportedFigures } from './narrative.js';

// August 2026 as the engine scores it: 23A, 23B NUL and 23C met target; 23B UL and 23E
// missed. 23C missed target in the most complete months (12).
const trend = (label, status, failMonths, parent = null) => ({
  label, parent, failMonths, observations: 20, latest: { status },
});
const intel = {
  latestFull: { label: 'August 2026' },
  trends: [
    trend('23A', 'PASS', 8),
    trend('23B NUL', 'PASS', 11),
    trend('23B UL', 'FAIL', 11),
    trend('23B UL Step 1', 'PASS', 10, '23B UL'),
    trend('23C', 'PASS', 12),
    trend('23E', 'FAIL', 9),
  ],
};

test('rejects a narrative that puts a passing service level among the failures', () => {
  // Verbatim from amazon.nova-pro-v1:0 during Iteration 2.
  const text =
    'In August 2026, three out of five service levels met their targets. Service levels 23A and 23B NUL passed with ' +
    'rates of 98.33% and 97.58% respectively, while 23B UL, 23C, and 23E failed with rates of 97.69%, 96.97%, and 94.29%.\n\n' +
    'Across the window from December 2024 to September 2026, service level 23B NUL has failed most often, missing its ' +
    'target in 11 out of 20 complete months scored.';
  const bad = contradictedClaims(text, intel);
  assert.ok(bad.some((b) => b.startsWith('23C said to miss target')), bad.join(' | '));
  assert.ok(bad.some((b) => b.startsWith('23B NUL said to fail most often')), bad.join(' | '));
  assert.ok(!bad.some((b) => b.startsWith('23A') || b.startsWith('23E')), bad.join(' | '));
});

test('accepts a narrative that states each result correctly', () => {
  const text =
    'In August 2026, 23A, 23B NUL and 23C met target. 23B UL at 97.69% and 23E at 94.29% missed their 98.00% target.\n\n' +
    '23C has missed target most often, in 12 of 21 complete months.';
  assert.deepEqual(contradictedClaims(text, intel), []);
});

test('a clause holding both kinds of word is not judged', () => {
  const text = 'In August 2026, 23C met target while 23E missed it; 23E met 33 deadlines and missed 2.';
  assert.deepEqual(contradictedClaims(text, intel), []);
});

test('figure guard flags numbers absent from the input', () => {
  assert.deepEqual(unsupportedFigures('23E ran at 94.29% with 855 overdue', { a: '94.29%', b: 855, c: '23E' }), []);
  assert.deepEqual(unsupportedFigures('23E ran at 93.10%', { a: '94.29%', c: '23E' }), ['93.10']);
});
