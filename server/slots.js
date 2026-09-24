/**
 * The five files a complete BaNCS extract set is made of.
 *
 * WRKFLWEXT is delivered as two files with identical columns — one of open items, one of
 * closed — so a workflow extract fills the 'open' or 'closed' slot according to its own
 * content (whether its rows carry a Close Date). A single file holding both fills both.
 */
export const EXTRACT_SLOTS = [
  { id: 'ebq', kind: 'ebq', mark: 'EB', label: 'EBQ Correspondence Report', feeds: ['23B_NUL', '23B_UL_S1'] },
  { id: 'cancellation', kind: 'cancellation', mark: 'CR', label: 'Cancellation Tracker (CANREVEXT)', feeds: ['23C'] },
  { id: 'withdrawal', kind: 'withdrawal', mark: 'WD', label: 'Withdrawal extract (WITHDRAWALEXT)', feeds: ['23B_UL_S2'] },
  { id: 'workflow-open', kind: 'workflow', mark: 'WO', label: 'Workflow extract — open items', feeds: ['23A', '23B_UL_S2', '23B_UL_S3', '23C', '23E'] },
  { id: 'workflow-closed', kind: 'workflow', mark: 'WC', label: 'Workflow extract — closed items', feeds: ['23A', '23B_UL_S2', '23B_UL_S3', '23C', '23E'] },
];

const isBlank = (v) => v == null || (typeof v === 'string' && (!v.trim() || v.trim().toLowerCase() === 'nan'));

/** Which slots a parsed extract fills. */
export function slotsOf(parsed) {
  if (parsed.kind !== 'workflow') return [parsed.kind];
  const closed = parsed.records.filter((r) => !isBlank(r['close date'])).length;
  const open = parsed.records.length - closed;
  const out = [];
  if (open) out.push('workflow-open');
  if (closed) out.push('workflow-closed');
  return out.length ? out : ['workflow-open'];
}

export const slotById = (id) => EXTRACT_SLOTS.find((s) => s.id === id);
