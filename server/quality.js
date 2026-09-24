import { OUTCOME, norm } from './engine/outcome.js';
import { byPolicy } from './engine/workflows.js';
import { monthOf } from './engine/datetime.js';
import { EXTRACT_SLOTS } from './slots.js';

/**
 * Data-quality findings — facts about the evidence, stated openly next to the figures.
 *
 * Every finding here is read straight off the extracts or the mapping; the conditions are the
 * ones SLA_Expected_Results.xlsx documents as defaults and traps. Severity:
 *   red    the figures for an SLA are incomplete or cannot be produced
 *   amber  items were measured on a documented default or could not be matched
 *   info   context a reader of the pack should know
 */

const plural = (n, one, many) => `${n.toLocaleString('en-IE')} ${n === 1 ? one : many}`;
const pct = (v) => `${(Math.round(v * 10000) / 100).toFixed(2)}%`;

function finding(list, f) {
  list.push({ id: `${f.type}:${list.length}`, affected: [], ...f });
}

const ORDER = { red: 0, amber: 1, info: 2 };
const sortFindings = (list) => list.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);

export const summarise = (list) => ({
  total: list.length,
  red: list.filter((f) => f.severity === 'red').length,
  amber: list.filter((f) => f.severity === 'amber').length,
  info: list.filter((f) => f.severity === 'info').length,
});

/** Findings about the extract set as a whole — shown on the Extracts screen and in every pack. */
export function setFindings({ sources, mappingRows, extracts, schedule }) {
  const out = [];
  const label = (id) => schedule.slas.find((s) => s.id === id)?.label ?? id;

  // 1. Extract types that have not been supplied.
  const present = new Set(sources.flatMap((s) => s.covers));
  for (const slot of EXTRACT_SLOTS) {
    if (present.has(slot.id)) continue;
    finding(out, {
      type: 'missing_extract',
      severity: 'red',
      title: `${slot.label} not supplied`,
      detail: `Without it, ${slot.feeds.map(label).join(', ')} cannot be fully measured.`,
      affected: slot.feeds,
    });
  }

  // 2. Mapping for 23B: quirks absorbed when it is read.
  const seen = new Map();
  let dupes = 0;
  for (const r of mappingRows) {
    const k = `${norm(r.product)}|${norm(r.transaction)}`;
    if (seen.has(k)) dupes++;
    seen.set(k, true);
  }
  const oddCodes = mappingRows.filter((r) => r.code && r.code.trim() !== r.code.trim().toUpperCase()).length;
  const padded = mappingRows.filter((r) => r.transaction !== r.transaction.trim() || r.product !== r.product.trim()).length;
  if (dupes || oddCodes || padded) {
    const bits = [];
    if (dupes) bits.push(`${plural(dupes, 'pair is', 'pairs are')} listed twice (each is counted once)`);
    if (oddCodes) bits.push(`${plural(oddCodes, 'code is', 'codes are')} not upper case, e.g. 'Ul' (read as UL)`);
    if (padded) bits.push(`${plural(padded, 'value has', 'values have')} stray spaces (trimmed before matching)`);
    finding(out, {
      type: 'mapping_quirks',
      severity: 'info',
      title: 'Mapping for 23B normalised on read',
      detail: `${bits.join('; ')}. Matching is on Product + Transaction, ignoring case and spacing.`,
      affected: ['23B_NUL', '23B_UL_S1'],
    });
  }

  // 3. Request IDs beyond Excel's 15-digit precision.
  const withdrawals = extracts.filter((e) => e.kind === 'withdrawal').flatMap((e) => e.records);
  const longIds = withdrawals.filter((r) => String(r['request id'] ?? '').replace(/\D/g, '').length > 15).length;
  if (longIds) {
    finding(out, {
      type: 'request_id_precision',
      severity: 'info',
      title: 'WITHDRAWALEXT Request IDs have lost precision',
      detail: `${plural(longIds, 'Request ID is', 'Request IDs are')} longer than Excel's 15 significant digits, so their final digits are unreliable. Withdrawals are matched to workflows by policy, never by Request ID.`,
      affected: ['23B_UL_S2'],
    });
  }

  // 4. Literal 'nan' placeholders left by the export.
  const nanCells = extracts.reduce(
    (n, e) => n + e.records.reduce((m, r) => m + Object.values(r).filter((v) => typeof v === 'string' && v.trim().toLowerCase() === 'nan').length, 0),
    0,
  );
  if (nanCells) {
    finding(out, {
      type: 'nan_placeholders',
      severity: 'info',
      title: `${plural(nanCells, 'cell holds', 'cells hold')} the text 'nan'`,
      detail: `An export placeholder for an empty value (e.g. 'Approver Role already approved' on withdrawals awaiting authorisation). Treated as blank.`,
      affected: [],
    });
  }

  return sortFindings(out);
}

/** Findings for one reporting month. */
export function monthFindings({ month, items, results, asOf, asOfLabel, unmapped, workflows, schedule, stepTwoMatched }) {
  const out = [];
  const label = (id) => schedule.slas.find((s) => s.id === id)?.label ?? id;
  const inMonth = items.filter((i) => i.month === month);
  const count = (pred) => inMonth.filter(pred);

  // 1. Period still running when the extract was taken.
  if (asOf.slice(0, 7) === month) {
    const due = count((i) => i.outcome === OUTCOME.OPEN_DUE).length;
    finding(out, {
      type: 'partial_period',
      severity: 'amber',
      title: `Period incomplete — extract taken ${asOfLabel}`,
      detail: `Activity after the extract date is not included${due ? `, and ${plural(due, 'item is', 'items are')} open but not yet due` : ''}. Figures for this month will move when a later extract is loaded.`,
      affected: [],
    });
  }

  // 2. Open items past their deadline, per SLA. 23B UL overall is the sum of its steps, so
  //    only the steps are reported — listing both would count every item twice.
  const rollups = new Set(schedule.slas.filter((s) => s.parts).map((s) => s.id));
  for (const r of results.filter((x) => !rollups.has(x.id) && x.openPastDeadline > 0)) {
    finding(out, {
      type: 'open_past_deadline',
      severity: 'red',
      title: `${label(r.id)}: ${plural(r.openPastDeadline, 'item', 'items')} open past deadline`,
      detail: `Still open at the extract date with the deadline already passed. They are outside Rate (Completed) ${r.rateCompleted == null ? '' : `(${pct(r.rateCompleted)}) `}but count against Rate (incl. Open)${r.rateInclOpen == null ? '' : `, which is ${pct(r.rateInclOpen)}`}.`,
      affected: [r.id],
    });
  }

  // 3. Withdrawals with no approval workflow to measure against.
  const noMatch = count((i) => i.outcome === OUTCOME.NO_MATCH);
  if (noMatch.length) {
    finding(out, {
      type: 'no_matching_workflow',
      severity: 'amber',
      title: `${plural(noMatch.length, 'withdrawal has', 'withdrawals have')} no approval workflow`,
      detail: `No 'Workflow for Withdrawal Approval' exists on the policy before the withdrawal's last status, so Step 2 has no clock start. Listed, not scored. Policies: ${noMatch.slice(0, 6).map((i) => i.policy).join(', ')}${noMatch.length > 6 ? ', …' : ''}.`,
      affected: [...new Set(noMatch.map((i) => i.sla))],
    });
  }

  // 4. Approval workflows no withdrawal points at.
  const def = schedule.slas.find((s) => s.id === '23B_UL_S2');
  if (def && workflows.length) {
    const orphans = [...byPolicy(workflows, def.params.workflowType).values()]
      .flat()
      .filter((w) => monthOf(w.created) === month && !stepTwoMatched.has(w.number));
    if (orphans.length) {
      finding(out, {
        type: 'unmatched_approval_workflow',
        severity: 'info',
        title: `${plural(orphans.length, 'withdrawal approval workflow has', 'withdrawal approval workflows have')} no withdrawal`,
        detail: `Created this month with no WITHDRAWALEXT record on the policy that they govern. Not part of Step 2. Workflows: ${orphans.slice(0, 6).map((w) => w.number).join(', ')}${orphans.length > 6 ? ', …' : ''}.`,
        affected: ['23B_UL_S2'],
      });
    }
  }

  // 5. An earlier workflow on the same policy was superseded.
  const superseded = count((i) => (i.candidateWorkflows ?? 0) > 1);
  if (superseded.length) {
    finding(out, {
      type: 'superseded_workflow',
      severity: 'info',
      title: `${plural(superseded.length, 'item had', 'items had')} more than one approval workflow`,
      detail: `The policy carried an earlier approval workflow before the one that led to the event; the latest one created before the event was used (workbook default 7).`,
      affected: [...new Set(superseded.map((i) => i.sla))],
    });
  }

  // 6. REJECTED alterations taken out of 23B.
  const rejected = count((i) => i.outcome === OUTCOME.EXCLUDED);
  if (rejected.length) {
    finding(out, {
      type: 'rejected_excluded',
      severity: 'info',
      title: `${plural(rejected.length, 'rejected EBQ item', 'rejected EBQ items')} excluded`,
      detail: `REJECTED transactions are not processing work and are left out of 23B (workbook default 4).`,
      affected: [...new Set(rejected.map((i) => i.sla))],
    });
  }

  // 7. EBQ transactions the mapping does not cover.
  const unmappedHere = unmapped.filter((u) => u.month === month);
  if (unmappedHere.length) {
    const pairs = new Map();
    for (const u of unmappedHere) {
      const k = `${u.product} / ${u.transactionType}`;
      pairs.set(k, (pairs.get(k) || 0) + 1);
    }
    const top = [...pairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    finding(out, {
      type: 'unmapped_ebq',
      severity: 'info',
      title: `${plural(unmappedHere.length, 'EBQ transaction is', 'EBQ transactions are')} outside Mapping for 23B`,
      detail: `Their Product + Transaction pair is not in the mapping, so they are not measured under 23B. Most frequent: ${top.map(([k, n]) => `${k} (${n})`).join('; ')}.`,
      affected: [],
    });
  }

  // 8. 23B items that depend on another workflow.
  const dependent = count((i) => i.dependency);
  if (dependent.length) {
    finding(out, {
      type: 'dependency',
      severity: 'info',
      title: `${plural(dependent.length, '23B item has', '23B items have')} a dependency in the mapping`,
      detail: `For example an underwriting assessment. The SLA is still measured from start to merged (workbook default 2).`,
      affected: [...new Set(dependent.map((i) => i.sla))],
    });
  }

  return sortFindings(out);
}
