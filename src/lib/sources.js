/**
 * Extract identity for the UI.
 *
 * The five marks are a ramp derived from the brand palette itself — violet through
 * periwinkle-grey to the two peach tones — so five distinguishable badges never introduce a
 * colour from outside the system.
 */
export const SOURCE_STYLE = {
  ebq: { mark: 'EB', colour: '#6e5be0', tint: '#ece9ff' },
  cancellation: { mark: 'CR', colour: '#9381ff', tint: '#efecff' },
  withdrawal: { mark: 'WD', colour: '#8189c4', tint: '#eceefa' },
  'workflow-open': { mark: 'WO', colour: '#d1843d', tint: '#ffeedd' },
  'workflow-closed': { mark: 'WC', colour: '#c0714f', tint: '#fbe6da' },
  workflow: { mark: 'WF', colour: '#c0714f', tint: '#fbe6da' },
};

export const styleFor = (id) => SOURCE_STYLE[id] ?? { mark: '??', colour: '#9a94be', tint: '#f2f0fb' };

/** A stored extract's badge: a workflow file is styled by the slot(s) it fills. */
export const styleForExtract = (e) =>
  styleFor(e.kind === 'workflow' ? (e.covers?.length === 1 ? e.covers[0] : 'workflow') : e.kind);
