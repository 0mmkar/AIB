import { parseStamp, dayOf, monthOf, isoOf, hoursBetween } from './datetime.js';
import { text, idOf } from './extracts.js';
import { byPolicy, latestBefore } from './workflows.js';
import { OUTCOME, judge, norm } from './outcome.js';

/**
 * One function per Schedule 23 SLA. Each returns item-level results:
 *
 *   { sla, key, month, outcome, startedAt, clockStart, beforeCutoff, deadline, completedAt, ...detail }
 *
 * plus a count of the rows it considered and ruled out of scope, so every figure on the
 * dashboard can be traced back to the rows that made it. All rules follow the README of
 * SLA_Expected_Results.xlsx, including its stated defaults where the contract is silent.
 */

const wfDetail = (w) => ({
  workflowNumber: w.number,
  workflowType: w.type,
  policy: w.policy,
  product: w.product,
  description: w.description,
  assignee: w.assignee,
  assigneeCode: w.assigneeCode,
  workflowOpen: w.open,
});

/** Shared shape for the SLAs measured on a workflow's own Created → Close dates. */
function workflowItem(ctx, sla, w, deadline) {
  const clock = ctx.cal.clockStart(w.created);
  return {
    sla,
    key: w.number,
    month: monthOf(w.created),
    outcome: judge(w.closeDay, deadline, ctx.asOfDay),
    startedAt: isoOf(w.created),
    clockStart: clock.day,
    beforeCutoff: clock.beforeCutoff,
    deadline,
    completedAt: w.closeDay,
    ...wfDetail(w),
  };
}

// ---------------------------------------------------------------- 23A

/** Issue Policy Immediately / at a Later Date, under the 3 pm rule. */
export function rule23A(ctx) {
  const types = new Set(ctx.def('23A').params.workflowTypes.map(norm));
  const items = ctx.workflows
    .filter((w) => types.has(norm(w.type)))
    .map((w) => workflowItem(ctx, '23A', w, ctx.cal.cutoffRule(w.created)));
  return { items, outOfScope: 0 };
}

// ---------------------------------------------------------------- 23B (EBQ)

/**
 * The mapping joins on Product + Transaction (column B), never the SLA statement. Keys are
 * trimmed and case-folded and codes upper-cased, which absorbs the workbook's planted
 * quirks: a trailing space, the code 'Ul', and pairs listed twice (a Map keeps one).
 */
export function buildMapping(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = `${norm(r.product)}|${norm(r.transaction)}`;
    const code = String(r.code ?? '').trim().toUpperCase();
    if (!code) continue;
    if (map.has(key) && map.get(key).code !== code) {
      throw new Error(`Mapping for 23B gives ${r.product} / ${r.transaction} two codes: ${map.get(key).code} and ${code}`);
    }
    if (!map.has(key)) map.set(key, { code, dependency: r.dependency ?? null });
  }
  return map;
}

/** 23B NUL (next business day) and 23B UL Step 1 (same business day), both from EBQ. */
export function rule23B_EBQ(ctx) {
  const ebq = ctx.extracts.filter((e) => e.kind === 'ebq').flatMap((e) => e.records);
  const nulCode = ctx.def('23B_NUL').params.mappingCode;
  const ulCode = ctx.def('23B_UL_S1').params.mappingCode;

  const items = [];
  let outOfScope = 0;
  for (const r of ebq) {
    const product = text(r, 'product');
    const transactionType = text(r, 'transaction type');
    const mapped = ctx.mapping.get(`${norm(product)}|${norm(transactionType)}`);
    const sla = mapped?.code === nulCode ? '23B_NUL' : mapped?.code === ulCode ? '23B_UL_S1' : null;
    if (!sla) {
      outOfScope++;
      continue;
    }

    const status = text(r, 'status').toUpperCase();
    const start = parseStamp(r['transaction start date']);
    const merged = parseStamp(r['transaction merged date']);
    const clock = ctx.cal.clockStart(start);
    const deadline = sla === '23B_NUL' ? ctx.cal.nextDay(start) : ctx.cal.sameDay(start);
    const completedAt = status === 'MERGED' ? dayOf(merged) : null;

    items.push({
      sla,
      key: text(r, 'transaction reference'),
      sourceRow: r._row,
      month: monthOf(start),
      outcome: status === 'REJECTED' ? OUTCOME.EXCLUDED : judge(completedAt, deadline, ctx.asOfDay),
      startedAt: dayOf(start),
      clockStart: clock.day,
      beforeCutoff: null, // EBQ carries no time of day
      deadline,
      completedAt,
      businessDaysTaken: completedAt ? ctx.cal.businessDaysBetween(clock.day, completedAt) : null,
      policy: idOf(r, 'policy number'),
      product,
      transactionType,
      transactionReference: text(r, 'transaction reference'),
      status,
      dependency: mapped.dependency,
      userId: text(r, 'user id'),
    });
  }
  return { items, outOfScope };
}

// ---------------------------------------------------------------- 23B UL Step 2

/**
 * Each withdrawal is matched to the policy's latest 'Workflow for Withdrawal Approval'
 * created at or before its last status. The clock is the workflow's Created Date under the
 * 3 pm rule; completion is the last-status time, and only a 'Complete' withdrawal is
 * complete — 'Awaiting Authorization' is still open.
 */
export function rule23B_Step2(ctx) {
  const def = ctx.def('23B_UL_S2');
  const approvals = byPolicy(ctx.workflows, def.params.workflowType);
  const complete = norm(def.params.completeStatus);
  const withdrawals = ctx.extracts.filter((e) => e.kind === 'withdrawal').flatMap((e) => e.records);

  const items = withdrawals.map((r) => {
    const policy = idOf(r, 'policy number');
    const last = parseStamp(r['date and time of last status']);
    const status = text(r, 'transaction status');
    const base = {
      sla: '23B_UL_S2',
      key: String(r._row),
      sourceRow: r._row,
      policy,
      product: text(r, 'product name'),
      transactionType: text(r, 'transaction type'),
      transactionStatus: status,
      amount: Number(r['transaction amount']) || null,
      lastStatusAt: isoOf(last),
    };

    const wf = latestBefore(approvals.get(policy), last);
    if (!wf) return { ...base, month: monthOf(last), outcome: OUTCOME.NO_MATCH };

    const clock = ctx.cal.clockStart(wf.created);
    const deadline = ctx.cal.cutoffRule(wf.created);
    const completedAt = norm(status) === complete ? dayOf(last) : null;
    return {
      ...base,
      ...wfDetail(wf),
      product: base.product,
      month: monthOf(wf.created),
      outcome: judge(completedAt, deadline, ctx.asOfDay),
      startedAt: isoOf(wf.created),
      clockStart: clock.day,
      beforeCutoff: clock.beforeCutoff,
      deadline,
      completedAt,
    };
  });
  return { items, outOfScope: 0 };
}

// ---------------------------------------------------------------- 23B UL Step 3

/** Workflow for Unit Adjustment, Created vs Close, under the 3 pm rule. */
export function rule23B_Step3(ctx) {
  const want = norm(ctx.def('23B_UL_S3').params.workflowType);
  const items = ctx.workflows
    .filter((w) => norm(w.type) === want)
    .map((w) => workflowItem(ctx, '23B_UL_S3', w, ctx.cal.cutoffRule(w.created)));
  return { items, outOfScope: 0 };
}

// ---------------------------------------------------------------- 23C

/**
 * Cancellations of the four protection products, measured from the matched 'Approve
 * Cancellation' workflow's Created Date to the cancellation's last-status time. Met only
 * when strictly under the limit: 47h59m30s is met, 48h00m00s is not.
 */
export function rule23C(ctx) {
  const { products, workflowType, maxHours } = ctx.def('23C').params;
  const inScope = new Set(products.map(norm));
  const approvals = byPolicy(ctx.workflows, workflowType);
  const rows = ctx.extracts.filter((e) => e.kind === 'cancellation').flatMap((e) => e.records);

  const items = [];
  let outOfScope = 0;
  for (const r of rows) {
    const product = text(r, 'product name');
    if (!inScope.has(norm(product))) {
      outOfScope++;
      continue;
    }
    const policy = idOf(r, 'policy number');
    const last = parseStamp(r['date and time of last status']);
    const base = {
      sla: '23C',
      key: String(r._row),
      sourceRow: r._row,
      policy,
      product,
      cancellationReason: text(r, 'cancellation reason'),
      lastStatusAt: isoOf(last),
      completedAt: dayOf(last),
    };

    const wf = latestBefore(approvals.get(policy), last);
    if (!wf) {
      items.push({ ...base, month: monthOf(last), outcome: OUTCOME.NO_MATCH });
      continue;
    }
    const elapsedHours = hoursBetween(wf.created, last);
    items.push({
      ...base,
      ...wfDetail(wf),
      product,
      month: monthOf(wf.created),
      outcome: elapsedHours < maxHours ? OUTCOME.MET : OUTCOME.MISSED,
      startedAt: isoOf(wf.created),
      elapsedHours: Math.round(elapsedHours * 10000) / 10000,
    });
  }
  return { items, outOfScope };
}

// ---------------------------------------------------------------- 23E

/**
 * Manual Review workflows mentioning 'EFT Payment Not Recognised', closed the same or next
 * business day. Real workflow types carry a suffix ('Manual Review - Existing Business'),
 * so the type is matched on its prefix; the phrase ignores case, and the 'Recognized'
 * spelling is a different phrase.
 */
export function rule23E(ctx) {
  const { workflowTypePrefix, phrase } = ctx.def('23E').params;
  const prefix = norm(workflowTypePrefix);
  const needle = norm(phrase);

  const items = [];
  let outOfScope = 0;
  for (const w of ctx.workflows) {
    const isType = norm(w.type).startsWith(prefix);
    const hasPhrase = norm(w.description).includes(needle);
    if (!isType || !hasPhrase) {
      if (isType || hasPhrase) outOfScope++;
      continue;
    }
    items.push(workflowItem(ctx, '23E', w, ctx.cal.nextDay(w.created)));
  }
  return { items, outOfScope };
}

export const RULES = [rule23A, rule23B_EBQ, rule23B_Step2, rule23B_Step3, rule23C, rule23E];
