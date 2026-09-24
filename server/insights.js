import { OUTCOME } from './engine/outcome.js';

/**
 * Where SLA failures concentrate.
 *
 * Purely descriptive: for each SLA, group the measured items by one of their own attributes
 * (who the workflow was assigned to, the product, the workflow or transaction type) and
 * count the failures in each group. A failure is an item that MISSED its deadline or is
 * still open past it. Nothing is modelled or projected.
 */

export const DIMENSIONS = [
  { id: 'assignee', label: 'Assigned to', get: (i) => i.assignee },
  { id: 'userId', label: 'EBQ user', get: (i) => i.userId },
  { id: 'product', label: 'Product', get: (i) => i.product },
  { id: 'workflowType', label: 'Workflow type', get: (i) => i.workflowType },
  { id: 'transactionType', label: 'Transaction type', get: (i) => i.transactionType },
];

export const isFailure = (i) => i.outcome === OUTCOME.MISSED || i.outcome === OUTCOME.OPEN_PAST;
export const isMeasured = (i) => i.outcome === OUTCOME.MET || isFailure(i);

const pct = (n, d) => (d ? Math.round((n / d) * 10000) / 100 : null);

/**
 * Failure concentration per SLA and dimension.
 *
 * `share` is the group's share of the SLA's failures; `volumeShare` its share of measured
 * items. A group only counts as a concentration when it fails at `minLift` times the SLA's
 * own rate or more — a group failing at roughly the average rate is just a big group. Groups
 * are ranked by excess failures: how many more than the group would have had at the SLA's
 * rate. Groups smaller than `minItems` are left out so one stray item cannot headline.
 */
export function missDrivers(items, { minItems = 5, minFailures = 2, minLift = 1.25, limit = 12 } = {}) {
  const bySla = new Map();
  for (const i of items) {
    if (!isMeasured(i)) continue;
    if (!bySla.has(i.sla)) bySla.set(i.sla, []);
    bySla.get(i.sla).push(i);
  }

  const out = [];
  for (const [sla, list] of bySla) {
    const failures = list.filter(isFailure).length;
    if (!failures) continue;
    const baseRate = failures / list.length;

    for (const dim of DIMENSIONS) {
      const groups = new Map();
      for (const i of list) {
        const key = String(dim.get(i) ?? '').trim();
        if (!key) continue;
        if (!groups.has(key)) groups.set(key, { measured: 0, missed: 0, openPastDeadline: 0 });
        const g = groups.get(key);
        g.measured++;
        if (i.outcome === OUTCOME.MISSED) g.missed++;
        if (i.outcome === OUTCOME.OPEN_PAST) g.openPastDeadline++;
      }
      // A dimension with a single value (e.g. every 23A item is one workflow type pair)
      // says nothing about concentration.
      if (groups.size < 2) continue;

      for (const [key, g] of groups) {
        const fails = g.missed + g.openPastDeadline;
        if (g.measured < minItems || fails < minFailures) continue;
        const rate = fails / g.measured;
        out.push({
          sla,
          dimension: dim.id,
          dimensionLabel: dim.label,
          key,
          measured: g.measured,
          missed: g.missed,
          openPastDeadline: g.openPastDeadline,
          failures: fails,
          failRatePct: pct(fails, g.measured),
          slaFailRatePct: pct(failures, list.length),
          sharePct: pct(fails, failures),
          volumeSharePct: pct(g.measured, list.length),
          timesSlaRate: Math.round((rate / baseRate) * 100) / 100,
          excessFailures: Math.round((fails - g.measured * baseRate) * 10) / 10,
        });
      }
    }
  }

  return out
    .filter((d) => d.timesSlaRate >= minLift)
    .sort((a, b) => b.excessFailures - a.excessFailures)
    .slice(0, limit);
}
