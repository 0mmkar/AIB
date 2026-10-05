import { styleFor } from '../lib/sources.js';

export function SourceChip({ sourceId, label, plain = false }) {
  const s = styleFor(sourceId);
  return (
    <span className={`src-chip${plain ? ' is-plain' : ''}`} style={plain ? undefined : { background: s.tint, color: s.colour }}>
      <span className="src-mark" style={{ background: s.colour }}>{s.mark}</span>
      {label}
    </span>
  );
}

/**
 * PASS / FAIL as the workbook judges it — on Rate (Completed) against target. A period with
 * no completed items has no verdict. The colour classes are the design system's status set.
 */
const STATUS = {
  PASS: { cls: 'rag-GREEN', label: 'Met target' },
  FAIL: { cls: 'rag-RED', label: 'Missed target' },
  NO_DATA: { cls: 'rag-NO_DATA', label: 'No completed policies' },
};

export function Status({ status, compact = false }) {
  const s = STATUS[status] ?? STATUS.NO_DATA;
  return (
    <span className={`rag ${s.cls}`}>
      <span className="rag-dot" />
      {compact ? (status === 'NO_DATA' ? 'No data' : status) : s.label}
    </span>
  );
}

/** Item outcomes. The chip is short; the workbook's own term is kept as its tooltip. */
const OUTCOME = {
  MET: { cls: 'rag-GREEN', label: 'Met' },
  MISSED: { cls: 'rag-RED', label: 'Missed' },
  'OPEN - PAST DEADLINE': { cls: 'rag-AMBER', label: 'Open · overdue' },
  'OPEN - NOT YET DUE': { cls: 'rag-NO_DATA', label: 'Open · not due' },
  'EXCLUDED - REJECTED': { cls: 'rag-NO_DATA', label: 'Excluded' },
  'NO MATCHING WORKFLOW': { cls: 'rag-AMBER', label: 'No workflow' },
};

export function Outcome({ outcome }) {
  const o = OUTCOME[outcome] ?? { cls: 'rag-NO_DATA', label: outcome };
  return (
    <span className={`rag ${o.cls}`} title={outcome}>
      <span className="rag-dot" />
      {o.label}
    </span>
  );
}
