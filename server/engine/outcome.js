/**
 * Item outcomes, in the vocabulary SLA_Expected_Results.xlsx uses.
 *
 * Only MET and MISSED are completed items and feed Rate (Completed). OPEN - PAST DEADLINE
 * additionally counts against Rate (incl. Open). The rest are recorded for traceability
 * but are not part of either rate.
 */
export const OUTCOME = {
  MET: 'MET',
  MISSED: 'MISSED',
  OPEN_PAST: 'OPEN - PAST DEADLINE',
  OPEN_DUE: 'OPEN - NOT YET DUE',
  EXCLUDED: 'EXCLUDED - REJECTED',
  NO_MATCH: 'NO MATCHING WORKFLOW',
};

/**
 * Deadline judgement for a day-based SLA. A completed item is met when it completed on or
 * before its deadline day. An open item is overdue once its deadline day is behind the
 * extract date — on the deadline day itself it can still be done in time.
 */
export function judge(completedDay, deadline, asOfDay) {
  if (completedDay) return completedDay <= deadline ? OUTCOME.MET : OUTCOME.MISSED;
  return deadline < asOfDay ? OUTCOME.OPEN_PAST : OUTCOME.OPEN_DUE;
}

/** Case- and spacing-insensitive text key — the mapping and workflow types need both. */
export const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
