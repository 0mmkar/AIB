import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeCalendar } from './calendar.js';
import { collectWorkflows, deriveAsOf } from './workflows.js';
import { RULES, buildMapping } from './rules.js';
import { OUTCOME } from './outcome.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

export const loadSchedule = () => readJson('config/sla-schedule.json');
export const loadMappingRows = () => readJson('config/mapping-23b.json').rows;

/**
 * Score a set of parsed extracts against Schedule 23.
 *
 * The extracts are one snapshot covering many months, so the result is item-level outcomes
 * plus a per-month roll-up — each item lands in the month its SLA is reported in (EBQ by
 * receipt month, workflow SLAs by workflow Created month).
 */
export function evaluate(extracts, { schedule = loadSchedule(), mappingRows = loadMappingRows(), asOf } = {}) {
  const workflows = collectWorkflows(extracts);
  const derived = deriveAsOf(workflows, extracts);
  const asOfDay = asOf ?? derived?.day;
  if (!asOfDay) throw new Error('Could not establish the extract date from the files; supply it explicitly');

  const defs = new Map(schedule.slas.map((s) => [s.id, s]));
  const ctx = {
    extracts,
    workflows,
    asOfDay,
    cal: makeCalendar(schedule.calendar),
    mapping: buildMapping(mappingRows),
    def: (id) => {
      if (!defs.has(id)) throw new Error(`SLA ${id} is not defined in config/sla-schedule.json`);
      return defs.get(id);
    },
  };

  const items = [];
  const outOfScope = {};
  for (const rule of RULES) {
    const res = rule(ctx);
    items.push(...res.items);
    const slaIds = [...new Set(res.items.map((i) => i.sla))];
    if (res.outOfScope) outOfScope[slaIds.join('+') || rule.name] = res.outOfScope;
  }

  return {
    asOf: asOfDay,
    asOfSource: asOf ? 'Set explicitly' : derived?.source,
    schedule,
    items,
    outOfScope,
    monthly: rollUp(items, schedule),
    totals: rollUpTotals(items, schedule),
  };
}

// ------------------------------------------------------------------ roll-up

const EMPTY = () => ({ met: 0, missed: 0, openPastDeadline: 0, openNotYetDue: 0, excluded: 0, noMatch: 0 });

function tally(counts, outcome) {
  if (outcome === OUTCOME.MET) counts.met++;
  else if (outcome === OUTCOME.MISSED) counts.missed++;
  else if (outcome === OUTCOME.OPEN_PAST) counts.openPastDeadline++;
  else if (outcome === OUTCOME.OPEN_DUE) counts.openNotYetDue++;
  else if (outcome === OUTCOME.EXCLUDED) counts.excluded++;
  else if (outcome === OUTCOME.NO_MATCH) counts.noMatch++;
}

/**
 * Rate (Completed) = Met / (Met + Missed) and PASS/FAIL is judged on it. Rate (incl. Open)
 * also counts open items past their deadline as not met. A period with nothing completed
 * has no rate and no verdict — it is not a pass.
 */
export function scoreCounts(def, counts) {
  const completed = counts.met + counts.missed;
  const withOpen = completed + counts.openPastDeadline;
  const rateCompleted = completed ? counts.met / completed : null;
  const rateInclOpen = withOpen ? counts.met / withOpen : null;
  return {
    id: def.id,
    label: def.label,
    name: def.name,
    parent: def.parent ?? null,
    target: def.target,
    ...counts,
    completed,
    rateCompleted,
    rateInclOpen,
    status: rateCompleted == null ? 'NO_DATA' : rateCompleted >= def.target - 1e-12 ? 'PASS' : 'FAIL',
  };
}

function countsBy(items, keyFn) {
  const out = new Map();
  for (const it of items) {
    const k = keyFn(it);
    if (!out.has(k)) out.set(k, new Map());
    const bySla = out.get(k);
    if (!bySla.has(it.sla)) bySla.set(it.sla, EMPTY());
    tally(bySla.get(it.sla), it.outcome);
  }
  return out;
}

/** Score every SLA — including 23B UL overall, the sum of its steps — from per-SLA counts. */
function scoreAll(schedule, bySla) {
  return schedule.slas.map((def) => {
    const counts = EMPTY();
    const parts = def.parts ?? [def.id];
    for (const p of parts) {
      const c = bySla?.get(p);
      if (c) for (const k of Object.keys(counts)) counts[k] += c[k];
    }
    return scoreCounts(def, counts);
  });
}

function rollUp(items, schedule) {
  const byMonth = countsBy(items, (i) => i.month);
  return [...byMonth.keys()]
    .filter(Boolean)
    .sort()
    .map((month) => ({ month, results: scoreAll(schedule, byMonth.get(month)) }));
}

function rollUpTotals(items, schedule) {
  return scoreAll(schedule, countsBy(items, () => 'all').get('all'));
}
