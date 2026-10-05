import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Status } from '../components/Chips.jsx';
import ItemTable from '../components/ItemTable.jsx';
import { IconAlert, IconInfo, IconCircleCheck } from '../components/Icons.jsx';
import { fmtRate, fmtTarget, fmtGap, fmtCount, progressOf } from '../lib/format.js';
import { POLICY_COUNT_NOTE } from '../lib/customerCopy.js';

const SEV_ICON = { red: <IconAlert />, amber: <IconAlert />, info: <IconInfo /> };
const STATUS_COLOUR = { PASS: 'var(--green)', FAIL: 'var(--red)', NO_DATA: 'var(--nodata)' };

export const slaLabeller = (slas) => {
  const map = Object.fromEntries(slas.map((s) => [s.id, s.label]));
  return (id) => map[id] ?? id;
};

/** Headline service levels in schedule order, each followed by its steps. */
export function orderedResults(results) {
  const out = [];
  for (const r of results.filter((x) => !x.parent)) {
    out.push(r);
    out.push(...results.filter((x) => x.parent === r.id));
  }
  return out;
}

export function SlaTable({ results, slas, selected, onSelect, compact = false }) {
  const defs = Object.fromEntries(slas.map((s) => [s.id, s]));
  return (
    <div className="table-scroll">
      <table className="table sla-table">
        <thead>
          <tr>
            <th style={{ width: compact ? '30%' : '22%' }}>Service level</th>
            <th className="num">Target</th>
            <th className="num">Met</th>
            <th className="num">Missed</th>
            <th className="num" title="Open at the data source date with the deadline passed">Open overdue</th>
            <th className="num">Rate (completed)</th>
            {!compact && <th className="num">Gap</th>}
            {!compact && <th style={{ width: 96 }}>Progress</th>}
            <th className="num" title="Counts overdue open policies as not met">Rate incl. open</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {orderedResults(results).map((r) => {
            const child = !!r.parent;
            const isSel = selected === r.id;
            return (
              <tr
                key={r.id}
                className={`${r.status === 'FAIL' && !child ? 'row-red' : r.status === 'NO_DATA' ? 'row-nodata' : ''}${child ? ' row-child' : ''}${isSel ? ' row-selected' : ''}`}
                onClick={onSelect ? () => onSelect(isSel ? null : r.id) : undefined}
                style={onSelect ? { cursor: 'pointer' } : undefined}
                title={`${defs[r.id]?.statement ?? ''}\nReported by: ${defs[r.id]?.monthBasis ?? ''}`}
              >
                <td>
                  <div className="metric-name" style={{ whiteSpace: 'nowrap' }}>
                    {child && <span className="child-mark">↳</span>}
                    {r.label}
                  </div>
                  <div className="metric-sub" style={child ? { paddingLeft: 22 } : undefined}>{r.name}</div>
                </td>
                <td className="num muted">{fmtTarget(r.target)}</td>
                <td className="num">{fmtCount(r.met)}</td>
                <td className="num" style={{ color: r.missed ? 'var(--red)' : undefined }}>{fmtCount(r.missed)}</td>
                <td className="num" style={{ color: r.openPastDeadline ? '#c9741a' : undefined }}>{fmtCount(r.openPastDeadline)}</td>
                <td className="num" style={{ color: STATUS_COLOUR[r.status], fontSize: 14 }}>{fmtRate(r.rateCompleted)}</td>
                {!compact && (
                  <td className="num" style={{ color: r.rateCompleted != null && r.rateCompleted < r.target ? 'var(--red)' : 'var(--ink-3)' }}>
                    {fmtGap(r.rateCompleted, r.target)}
                  </td>
                )}
                {!compact && (
                  <td>
                    {r.rateCompleted == null ? (
                      <span className="tiny muted">—</span>
                    ) : (
                      <div className="bar">
                        <span style={{ width: `${progressOf(r.rateCompleted, r.target) * 100}%`, background: STATUS_COLOUR[r.status] }} />
                        <i className="mark" style={{ left: '50%' }} />
                      </div>
                    )}
                  </td>
                )}
                <td className="num muted">{fmtRate(r.rateInclOpen)}</td>
                <td><Status status={r.status} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function QualityPanel({ flags, slas, emptyText = "No data-quality issues found in this period's evidence." }) {
  const label = slaLabeller(slas);
  if (!flags?.length) {
    return (
      <div className="row" style={{ gap: 10, color: 'var(--green)' }}>
        <IconCircleCheck size={18} />
        <span className="tiny" style={{ color: 'var(--ink-2)' }}>{emptyText}</span>
      </div>
    );
  }
  return (
    <div>
      {flags.map((f) => (
        <div key={f.id} className={`flag sev-${f.severity}`}>
          <div className="flag-icon">{SEV_ICON[f.severity]}</div>
          <div>
            <div className="flag-title">{f.title}</div>
            <div className="flag-detail">{f.detail}</div>
            {f.affected?.length > 0 && (
              <div className="flag-metrics">
                {f.affected.map((id) => <span key={id} className="tag muted">{label(id)}</span>)}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Where a period's or a history's failures sit — groups failing well above their SLA's rate. */
export function DriversPanel({ drivers, slas, limit = 6, emptyText }) {
  const label = slaLabeller(slas);
  if (!drivers?.length) {
    return (
      <div className="row" style={{ gap: 10, color: 'var(--green)' }}>
        <IconCircleCheck size={18} />
        <span className="tiny" style={{ color: 'var(--ink-2)' }}>
          {emptyText ?? 'No group fails at 1.25× its service level’s rate or more — failures are spread, not concentrated.'}
        </span>
      </div>
    );
  }
  return (
    <div>
      {drivers.slice(0, limit).map((d) => (
        <div key={`${d.sla}-${d.dimension}-${d.key}`} className="cluster-row">
          <div>
            <div className="row" style={{ gap: 8 }}>
              <span className="cluster-driver">{d.key}</span>
              <span className="tag muted">{d.dimensionLabel}</span>
              <span className="tag">{label(d.sla)}</span>
            </div>
            <div className="cluster-meta">
              {fmtCount(d.failures)} of {fmtCount(d.measured)} policies failed ({fmtCount(d.missed)} missed
              {d.openPastDeadline ? `, ${fmtCount(d.openPastDeadline)} open overdue` : ''}) · {d.sharePct}% of {label(d.sla)} failures from{' '}
              {d.volumeSharePct}% of its volume
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="cluster-delta">{d.failRatePct}%</div>
            <div className="cluster-persist">fail rate vs {d.slaFailRatePct}%</div>
            <div className="cluster-persist">{d.timesSlaRate}× the service level</div>
          </div>
        </div>
      ))}
    </div>
  );
}

const OUTCOME_FILTERS = ['MET', 'MISSED', 'OPEN - PAST DEADLINE', 'OPEN - NOT YET DUE', 'EXCLUDED - REJECTED', 'NO MATCHING WORKFLOW'];

/** Every item behind one SLA line for the month, filterable by outcome. */
function SlaItems({ month, slaId, slas, onClose }) {
  const [items, setItems] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const label = slaLabeller(slas);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    api.items(month, { sla: slaId }).then((r) => !cancelled && setItems(r.items));
    return () => { cancelled = true; };
  }, [month, slaId]);

  const counts = {};
  for (const i of items ?? []) counts[i.outcome] = (counts[i.outcome] || 0) + 1;
  const shown = (items ?? []).filter((i) => !outcome || i.outcome === outcome);
  const def = slas.find((s) => s.id === slaId);

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>{label(slaId)} · policies this period</h2>
          <div className="sub">{def?.statement}</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
      </div>
      {!items ? (
        <div className="empty" style={{ padding: 30 }}><span className="spinner" /></div>
      ) : (
        <>
          <div className="filter-bar">
            <button className={`scope-chip${!outcome ? ' is-active' : ''}`} onClick={() => setOutcome(null)}>All · {fmtCount(items.length)}</button>
            {OUTCOME_FILTERS.filter((o) => counts[o]).map((o) => (
              <button key={o} className={`scope-chip${outcome === o ? ' is-active' : ''}`} onClick={() => setOutcome(o)}>
                {o.toLowerCase()} · {fmtCount(counts[o])}
              </button>
            ))}
          </div>
          <ItemTable items={shown} slaLabel={label} showSla={!!def?.parts} />
        </>
      )}
    </div>
  );
}

export default function Position({ analysis, slas }) {
  const [selected, setSelected] = useState(null);
  const { results, summary: s, quality, quality_summary: qs, drivers } = analysis;
  const label = slaLabeller(slas);

  useEffect(() => setSelected(null), [analysis.reporting_month]);

  return (
    <>
      {analysis.partial && (
        <div className="card" style={{ background: 'linear-gradient(104deg, var(--papaya) 0%, #fff 46%)', borderColor: 'var(--apricot)' }}>
          <div className="card-pad row" style={{ gap: 12 }}>
            <IconAlert />
            <span className="tiny" style={{ color: 'var(--ink-2)', lineHeight: 1.55 }}>
              <b>{analysis.label} is incomplete.</b> The data source snapshot was taken on {analysis.as_of_label}; activity after it is not
              included and {fmtCount(s.openNotYetDue)} {s.openNotYetDue === 1 ? 'policy is' : 'policies are'} open but not yet due.
            </span>
          </div>
        </div>
      )}

      <div className="stat-row">
        <div className="stat accent-green">
          <div className="stat-label">Met target</div>
          <div className="stat-value" style={{ color: 'var(--green)' }}>{s.pass}<span style={{ fontSize: 15, color: 'var(--ink-4)' }}> / {s.total}</span></div>
          <div className="stat-note">service levels judged on Rate (completed)</div>
        </div>
        <div className="stat accent-red">
          <div className="stat-label">Missed target</div>
          <div className="stat-value" style={{ color: s.fail ? 'var(--red)' : undefined }}>{s.fail}</div>
          <div className="stat-note">{s.failing.length ? s.failing.map(label).join(', ') : 'none this period'}</div>
        </div>
        <div className="stat accent-violet">
          <div className="stat-label">Policies measured</div>
          <div className="stat-value">{fmtCount(s.measured)}</div>
          <div className="stat-note">{fmtCount(s.met)} met · {fmtCount(s.missed)} missed · {fmtCount(s.openPastDeadline)} open overdue</div>
        </div>
        <div className="stat accent-amber">
          <div className="stat-label">Open past deadline</div>
          <div className="stat-value" style={{ color: s.openPastDeadline ? '#c9741a' : undefined }}>{fmtCount(s.openPastDeadline)}</div>
          <div className="stat-note">{s.openNotYetDue ? `${fmtCount(s.openNotYetDue)} more open, not yet due` : 'at the data source date'}</div>
        </div>
        {s.noData > 0 && (
          <div className="stat">
            <div className="stat-label">No completed policies</div>
            <div className="stat-value" style={{ color: 'var(--nodata)' }}>{s.noData}</div>
            <div className="stat-note">no rate, so no verdict</div>
          </div>
        )}
        <div className="stat accent-amber">
          <div className="stat-label">Data quality</div>
          <div className="stat-value">{qs.total}</div>
          <div className="stat-note">{qs.red} critical · {qs.amber} warning · {qs.info} note</div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Schedule 23 · SLA Status</h2>
            <div className="sub">
              Pass or fail on Rate (completed) = met ÷ (met + missed). Rate incl. open also counts overdue open policies as
              not met. Select a line to see its policies.
            </div>
            <div className="sub">{POLICY_COUNT_NOTE}</div>
          </div>
        </div>
        <SlaTable results={results} slas={slas} selected={selected} onSelect={setSelected} />
      </div>

      {selected && <SlaItems month={analysis.reporting_month} slaId={selected} slas={slas} onClose={() => setSelected(null)} />}

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Where failures concentrate</h2>
            <div className="sub">Groups failing at 1.25× their service level’s rate or more, ranked by failures above that rate</div>
          </div>
        </div>
        <div className="card-pad"><DriversPanel drivers={drivers} slas={slas} /></div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Data quality</h2>
            <div className="sub">Facts about the evidence behind this period, stated next to the figures rather than estimated over</div>
          </div>
        </div>
        <div className="card-pad"><QualityPanel flags={quality} slas={slas} /></div>
      </div>
    </>
  );
}
