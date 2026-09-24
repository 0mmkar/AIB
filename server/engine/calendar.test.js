import test from 'node:test';
import assert from 'node:assert/strict';

import { makeCalendar } from './calendar.js';
import { parseStamp, dayOf, hoursBetween } from './datetime.js';
import { judge, OUTCOME } from './outcome.js';

const cal = makeCalendar({ cutoffHour: 15, holidays: ['2026-03-17', '2025-12-25', '2025-12-26'] });
const at = (s) => parseStamp(s);

test('parses every timestamp shape the extracts use', () => {
  assert.equal(at('26/08/2026 22:11:38').toISOString(), '2026-08-26T22:11:38.000Z');
  assert.equal(at('10/03/2025').toISOString(), '2025-03-10T00:00:00.000Z');
  assert.equal(at(46260.92474537037).toISOString(), '2026-08-26T22:11:38.000Z'); // Excel serial
  assert.equal(at(new Date('2026-08-26T22:11:37.9995Z')).toISOString(), '2026-08-26T22:11:38.000Z');
  assert.equal(at('nan'), null);
  assert.equal(at('  '), null);
});

test('3 pm cut-off: 14:59:59 is before, 15:00:00 is not', () => {
  assert.equal(cal.cutoffRule(at('02/09/2026 14:59:59')), '2026-09-02');
  assert.equal(cal.cutoffRule(at('02/09/2026 15:00:00')), '2026-09-03');
});

test('a Friday after 3 pm is due Monday', () => {
  assert.equal(cal.cutoffRule(at('04/09/2026 16:30:00')), '2026-09-07');
});

test('weekend and holiday starts move to the next business day and count as before 3 pm', () => {
  const sat = cal.clockStart(at('05/09/2026 18:00:00'));
  assert.deepEqual(sat, { day: '2026-09-07', beforeCutoff: true });
  assert.equal(cal.cutoffRule(at('05/09/2026 18:00:00')), '2026-09-07');
  assert.equal(cal.nextDay(at('05/09/2026 18:00:00')), '2026-09-08');
  assert.equal(cal.clockStart(at('17/03/2026 09:00:00')).day, '2026-03-18'); // St Patrick's Day
});

test('next business day skips Christmas and St Stephen\'s Day', () => {
  assert.equal(cal.nextDay(at('24/12/2025 10:00:00')), '2025-12-29');
});

test('business days taken does not count the start day', () => {
  assert.equal(cal.businessDaysBetween('2026-09-04', '2026-09-07'), 1);
  assert.equal(cal.businessDaysBetween('2026-09-07', '2026-09-07'), 0);
});

test('48 hours: 47h59m30s is under, 48h00m00s is not', () => {
  const start = at('01/09/2026 10:00:00');
  assert.ok(hoursBetween(start, at('03/09/2026 09:59:30')) < 48);
  assert.ok(!(hoursBetween(start, at('03/09/2026 10:00:00')) < 48));
});

test('open items are overdue only once the deadline day has passed', () => {
  assert.equal(judge(null, '2026-09-23', '2026-09-24'), OUTCOME.OPEN_PAST);
  assert.equal(judge(null, '2026-09-24', '2026-09-24'), OUTCOME.OPEN_DUE);
  assert.equal(judge('2026-09-24', '2026-09-24', '2026-09-30'), OUTCOME.MET);
  assert.equal(judge('2026-09-25', '2026-09-24', '2026-09-30'), OUTCOME.MISSED);
  assert.equal(dayOf(at('24/09/2026 23:59:59')), '2026-09-24');
});
