import { parseStamp, dayOf, addDays } from './datetime.js';
import { text, idOf } from './extracts.js';
import { norm } from './outcome.js';

/**
 * WRKFLWEXT arrives as two files with the same 16 columns: open items (In Progress, with
 * Pending Since Days) and closed items (with a Close Date). They are one population, so
 * they are unioned here and every SLA that needs workflows reads this single list.
 */
export function collectWorkflows(extracts) {
  const out = [];
  for (const ex of extracts.filter((e) => e.kind === 'workflow')) {
    for (const r of ex.records) {
      const created = parseStamp(r['created date']);
      if (!created) continue;
      const closed = parseStamp(r['close date']);
      out.push({
        number: idOf(r, 'workflow number'),
        type: text(r, 'workflow type'),
        policy: idOf(r, 'reference number'),
        product: text(r, 'product name'),
        created,
        closeDay: dayOf(closed),
        status: text(r, 'status'),
        open: !closed,
        description: text(r, 'workflow description'),
        assignee: text(r, 'assigned to name'),
        assigneeCode: text(r, 'assigned to'),
        createdBy: text(r, 'created by'),
        pendingDays: r['pending since days'] == null || r['pending since days'] === '' ? null : Number(r['pending since days']),
        sourceRow: r._row,
      });
    }
  }
  return out;
}

/** Workflows of one type, grouped by policy and ordered by creation time. */
export function byPolicy(workflows, type) {
  const want = norm(type);
  const map = new Map();
  for (const w of workflows) {
    if (norm(w.type) !== want) continue;
    if (!map.has(w.policy)) map.set(w.policy, []);
    map.get(w.policy).push(w);
  }
  for (const list of map.values()) list.sort((a, b) => a.created - b.created);
  return map;
}

/**
 * The workflow that governs an event: of the policy's workflows, the latest one created at
 * or before the event. A policy with an earlier, withdrawn approval workflow must be judged
 * on the one that actually led to the event.
 */
export function latestBefore(list, when) {
  if (!list || !when) return null;
  let hit = null;
  for (const w of list) if (w.created <= when) hit = w;
  return hit;
}

/**
 * The extract date, read from the content: an open workflow's Created Date plus its
 * Pending Since Days lands on the day the extract was taken. The most common landing day
 * wins, so one odd row cannot move it. Falls back to the day after the latest activity.
 */
export function deriveAsOf(workflows, extracts) {
  const votes = new Map();
  for (const w of workflows) {
    if (!w.open || w.pendingDays == null || Number.isNaN(w.pendingDays)) continue;
    const day = addDays(dayOf(w.created), w.pendingDays);
    votes.set(day, (votes.get(day) || 0) + 1);
  }
  if (votes.size) {
    const [day, n] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    return { day, source: `Workflow Created Date + Pending Since Days (${n} open workflows agree)` };
  }

  let latest = null;
  for (const ex of extracts) {
    for (const r of ex.records) {
      for (const v of Object.values(r)) {
        if (v instanceof Date || (typeof v === 'string' && /^\d{1,2}\/\d{1,2}\/\d{4}/.test(v))) {
          const d = parseStamp(v);
          if (d && (!latest || d > latest)) latest = d;
        }
      }
    }
  }
  return latest ? { day: addDays(dayOf(latest), 1), source: 'Day after the latest activity in the extracts' } : null;
}
