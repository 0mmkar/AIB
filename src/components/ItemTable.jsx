import { useMemo, useState } from 'react';
import { Outcome } from './Chips.jsx';
import { fmtDay, fmtHours, fmtCount } from '../lib/format.js';

const PAGE = 100;

/** The record an item came from, in the terms of its own extract. */
function reference(i) {
  if (i.transactionReference) return { main: i.transactionReference, sub: `EBQ row ${i.sourceRow}` };
  if (i.sla === '23B_UL_S2') return { main: `WITHDRAWALEXT row ${i.sourceRow}`, sub: i.workflowNumber ? `workflow ${i.workflowNumber}` : 'no workflow' };
  if (i.sla === '23C') return { main: `CANREVEXT row ${i.sourceRow}`, sub: i.workflowNumber ? `workflow ${i.workflowNumber}` : 'no workflow' };
  return { main: `Workflow ${i.workflowNumber}`, sub: i.workflowOpen ? 'open' : 'closed' };
}

/** How long it took, in the unit its rule is measured in. */
function taken(i) {
  if (i.elapsedHours != null) return fmtHours(i.elapsedHours);
  if (i.businessDaysTaken != null) return `${i.businessDaysTaken} business day${i.businessDaysTaken === 1 ? '' : 's'}`;
  return null;
}

/**
 * Item-level evidence behind an SLA figure: one row per measured record, with the clock
 * start, the deadline the rule set and when it actually completed.
 */
export default function ItemTable({ items, slaLabel, showSla = true }) {
  const [shown, setShown] = useState(PAGE);
  const rows = useMemo(() => items.slice(0, shown), [items, shown]);

  if (!items.length) return <p className="tiny muted" style={{ padding: '4px 2px' }}>No policies.</p>;

  return (
    <>
      <div className="table-scroll">
        <table className="table item-table">
          <thead>
            <tr>
              <th>Record</th>
              {showSla && <th>SLA</th>}
              <th>Policy · product</th>
              <th>Type</th>
              <th>Handled by</th>
              <th>Clock start → deadline</th>
              <th>Completed</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => {
              const ref = reference(i);
              const done = i.lastStatusAt && i.sla === '23C' ? i.lastStatusAt : i.completedAt;
              return (
                <tr key={`${i.sla}-${i.key}`}>
                  <td>
                    <div className="metric-name mono">{ref.main}</div>
                    <div className="metric-sub">{ref.sub}</div>
                  </td>
                  {showSla && <td className="tiny" style={{ whiteSpace: 'nowrap' }}>{slaLabel(i.sla)}</td>}
                  <td>
                    <div className="mono tiny">{i.policy || '—'}</div>
                    <div className="metric-sub">{i.product}</div>
                  </td>
                  <td className="tiny" style={{ maxWidth: 200 }}>{i.transactionType || i.workflowType || '—'}</td>
                  <td className="tiny">{i.assignee || i.userId || '—'}</td>
                  <td className="tiny" style={{ whiteSpace: 'nowrap' }}>
                    {i.clockStart ? fmtDay(i.clockStart) : i.startedAt ? fmtDay(i.startedAt) : '—'}
                    <span className="muted"> → </span>
                    {i.deadline ? fmtDay(i.deadline) : i.sla === '23C' ? 'under 48h' : '—'}
                    {i.beforeCutoff === false && <div className="metric-sub">created 15:00 or later</div>}
                  </td>
                  <td className="tiny" style={{ whiteSpace: 'nowrap' }}>
                    {done ? fmtDay(done) : <span className="muted">open</span>}
                    {taken(i) && <div className="metric-sub">took {taken(i)}</div>}
                  </td>
                  <td><Outcome outcome={i.outcome} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {items.length > shown && (
        <div className="row" style={{ justifyContent: 'center', padding: 12 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setShown((n) => n + PAGE)}>
            Show more · {fmtCount(items.length - shown)} remaining
          </button>
        </div>
      )}
    </>
  );
}
