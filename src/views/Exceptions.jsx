import { useMemo, useState } from 'react';
import { Status } from '../components/Chips.jsx';
import ItemTable from '../components/ItemTable.jsx';
import { DriversPanel, slaLabeller } from './Position.jsx';
import { IconShield, IconCircleCheck } from '../components/Icons.jsx';
import { fmtRate, fmtTarget, fmtGap, fmtCount } from '../lib/format.js';

function ExceptionRow({ r, steps }) {
  return (
    <div className="exception-card">
      <div>
        <div className="row wrap" style={{ gap: 9 }}>
          <span className="exception-name">{r.label} · {r.name}</span>
        </div>
        <div className="exception-meta">
          {fmtCount(r.met)} met · {fmtCount(r.missed)} missed
          {r.openPastDeadline ? ` · ${fmtCount(r.openPastDeadline)} open past deadline` : ''}
          {steps.length > 0 && ` · below target: ${steps.map((s) => `${s.label} (${fmtRate(s.rateCompleted)})`).join(', ')}`}
        </div>
      </div>
      <div className="exception-figures">
        <div className="figure">
          <div className="figure-label">Target</div>
          <div className="figure-value" style={{ color: 'var(--ink-3)' }}>{fmtTarget(r.target)}</div>
        </div>
        <div className="figure">
          <div className="figure-label">Rate</div>
          <div className="figure-value is-bad">{fmtRate(r.rateCompleted)}</div>
        </div>
        <div className="figure">
          <div className="figure-label">Gap</div>
          <div className="figure-value is-bad">{fmtGap(r.rateCompleted, r.target)}</div>
        </div>
        <Status status={r.status} />
      </div>
    </div>
  );
}

export default function Exceptions({ analysis, slas }) {
  const [sla, setSla] = useState(null);
  const [kind, setKind] = useState(null);
  const label = slaLabeller(slas);
  const { results, exceptions } = analysis;

  const failing = results.filter((r) => !r.parent && r.status === 'FAIL');
  const headline = results.filter((r) => !r.parent);

  const counts = useMemo(() => {
    const c = {};
    for (const i of exceptions) c[i.sla] = (c[i.sla] || 0) + 1;
    return c;
  }, [exceptions]);

  const shown = exceptions.filter((i) => (!sla || i.sla === sla) && (!kind || i.outcome === kind));
  const missed = exceptions.filter((i) => i.outcome === 'MISSED').length;
  const overdue = exceptions.length - missed;

  return (
    <>
      <div className="card" style={{ background: failing.length ? 'linear-gradient(104deg, var(--red-bg) 0%, #fff 46%)' : undefined, borderColor: failing.length ? '#f6cdd5' : undefined }}>
        <div className="card-pad row" style={{ gap: 16 }}>
          <div style={{
            width: 46, height: 46, borderRadius: 15, display: 'grid', placeItems: 'center', flex: '0 0 46px',
            background: failing.length ? '#fbdde3' : 'var(--green-bg)', color: failing.length ? 'var(--red)' : 'var(--green)',
          }}>
            <IconShield size={22} />
          </div>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: 16 }}>
              {failing.length
                ? `${failing.length} of ${headline.length} service levels missed target in ${analysis.label}`
                : `Every service level with completed policies met target in ${analysis.label}`}
            </h2>
            <p className="tiny muted" style={{ marginTop: 5, lineHeight: 1.55 }}>
              {fmtCount(missed)} {missed === 1 ? 'policy' : 'policies'} missed {missed === 1 ? 'its' : 'their'} deadline and {fmtCount(overdue)}{' '}
              {overdue === 1 ? 'is' : 'are'} still open past it. Every one is listed below with the record it came from.
            </p>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Missed target</h2>
            <div className="sub">Rate (completed) below the Schedule 23 target</div>
          </div>
          <span className="tag warm">{failing.length} of {headline.length}</span>
        </div>
        <div className="card-pad">
          {failing.length ? (
            failing.map((r) => (
              <ExceptionRow key={r.id} r={r} steps={results.filter((x) => x.parent === r.id && x.status === 'FAIL')} />
            ))
          ) : (
            <div className="row" style={{ gap: 10, color: 'var(--green)' }}>
              <IconCircleCheck size={18} />
              <span className="tiny" style={{ color: 'var(--ink-2)' }}>No service level missed target this period.</span>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Policies with exceptions</h2>
            <div className="sub">Every policy that missed its deadline or is still open past it</div>
          </div>
          <span className="tag">{fmtCount(exceptions.length)}</span>
        </div>
        <div className="filter-bar">
          <button className={`scope-chip${!sla ? ' is-active' : ''}`} onClick={() => setSla(null)}>All SLAs</button>
          {slas.filter((s) => counts[s.id]).map((s) => (
            <button key={s.id} className={`scope-chip${sla === s.id ? ' is-active' : ''}`} onClick={() => setSla(s.id)}>
              {s.label} · {fmtCount(counts[s.id])}
            </button>
          ))}
          <span className="filter-sep" />
          <button className={`scope-chip${!kind ? ' is-active' : ''}`} onClick={() => setKind(null)}>Both</button>
          <button className={`scope-chip${kind === 'MISSED' ? ' is-active' : ''}`} onClick={() => setKind('MISSED')}>Missed</button>
          <button className={`scope-chip${kind === 'OPEN - PAST DEADLINE' ? ' is-active' : ''}`} onClick={() => setKind('OPEN - PAST DEADLINE')}>Open overdue</button>
        </div>
        <ItemTable items={shown} slaLabel={label} />
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Where this period’s failures concentrate</h2>
            <div className="sub">Groups failing at 1.25× their service level’s rate or more</div>
          </div>
        </div>
        <div className="card-pad"><DriversPanel drivers={analysis.drivers} slas={slas} /></div>
      </div>
    </>
  );
}
