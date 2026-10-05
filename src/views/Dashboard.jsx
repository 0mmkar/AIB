import Logo from '../components/Logo.jsx';
import { IconCloud, IconDoc, IconClock } from '../components/Icons.jsx';
import { fmtCount } from '../lib/format.js';
import { POLICY_COUNT_NOTE } from '../lib/customerCopy.js';

/**
 * Landing screen. Every reporting period built from the current extract set, newest first
 * and grouped by year, with the headline pass/fail of the five Schedule 23 service levels.
 */
export default function Dashboard({ boot, onOpenMonth, onExtracts }) {
  const { months, snapshot, slas } = boot;
  const labelOf = Object.fromEntries(slas.map((s) => [s.id, s.label]));
  const headline = slas.filter((s) => !s.parent);
  const packMonth = months.find((m) => !m.partial) ?? months[0];

  const totals = months.reduce(
    (acc, m) => ({
      fails: acc.fails + (m.summary?.fail ?? 0),
      overdue: acc.overdue + (m.summary?.openPastDeadline ?? 0),
    }),
    { fails: 0, overdue: 0 },
  );

  const byYear = new Map();
  for (const m of months) {
    const y = m.month.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(m);
  }

  return (
    <div className="dash">
      {/* ------------------------------------------------------------- hero */}
      <div className="dash-hero">
        <div className="dash-hero-body">
          <Logo height={30} plate={false} />
          <h1>SLA Governance</h1>
          <p>
            {headline.length} Schedule 23 service levels — {headline.map((s) => s.label).join(', ')} — measured policy by
            policy from the data sources against their business-day rules, with one governance pack per reporting month.
          </p>
          <div className="dash-hero-note" style={{ whiteSpace: 'normal' }}>{POLICY_COUNT_NOTE}</div>
          <div className="dash-hero-actions">
            <button className="btn btn-hero" onClick={onExtracts}>
              <IconCloud size={18} />
              {snapshot ? 'Manage data sources' : 'Load data sources'}
            </button>
            {packMonth && (
              <button className="btn btn-soft" onClick={() => onOpenMonth(packMonth.month, 'pack')}>
                <IconDoc size={18} /> Governance pack · {packMonth.label}
              </button>
            )}
            {snapshot && (
              <span className="dash-hero-note">
                Data source as of <b>{snapshot.as_of_label}</b> · {snapshot.sourceCount} files
              </span>
            )}
          </div>
        </div>

        {snapshot && (
          <div className="dash-hero-stats">
            <HeroStat label="Reporting periods" value={months.length} />
            <HeroStat label="Data source records read" value={fmtCount(snapshot.records)} />
            <HeroStat label="Service-level months below target" value={totals.fails} tone="red" />
            <HeroStat label="Policies open past deadline" value={fmtCount(totals.overdue)} tone="warm" />
          </div>
        )}
      </div>

      {months.length === 0 ? (
        <div className="card empty">
          <div className="empty-icon"><IconDoc size={26} /></div>
          <h3>No governance packs yet</h3>
          <p>Load the data sources — EBQ, CANREVEXT, WITHDRAWALEXT and the two WRKFLWEXT files — and a pack is built for every month they cover.</p>
          <button className="btn btn-primary btn-sm" style={{ marginTop: 14 }} onClick={onExtracts}>Go to data sources</button>
        </div>
      ) : (
        [...byYear.entries()].map(([year, list]) => (
          <section key={year}>
            <div className="dash-section-head">
              <h2>{year}</h2>
              <span className="tiny muted">
                {list.length} reporting period{list.length === 1 ? '' : 's'} · open one for its SLA Status, exceptions and pack
              </span>
            </div>
            <div className="dash-grid">
              {list.map((m) => <PeriodCard key={m.month} m={m} labelOf={labelOf} onOpen={onOpenMonth} />)}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function HeroStat({ label, value, tone }) {
  return (
    <div className={`hero-stat${tone ? ` tone-${tone}` : ''}`}>
      <div className="hero-stat-value">{value}</div>
      <div className="hero-stat-label">{label}</div>
    </div>
  );
}

function PeriodCard({ m, labelOf, onOpen }) {
  const s = m.summary;
  const segments = [
    { key: 'PASS', n: s.pass, colour: 'var(--green)' },
    { key: 'FAIL', n: s.fail, colour: 'var(--red)' },
    { key: 'NO_DATA', n: s.noData, colour: 'var(--nodata)' },
  ].filter((x) => x.n > 0);
  const clean = s.fail === 0;

  return (
    <button className={`period-card${m.partial ? ' is-open' : ''}`} onClick={() => onOpen(m.month, 'position')}>
      <div className="period-top">
        <span className="period-label">{m.label}</span>
        {m.partial ? (
          <span className="tag warm">Incomplete</span>
        ) : clean ? (
          <span className="tag" style={{ background: 'var(--green-bg)', color: 'var(--green)' }}>All met</span>
        ) : (
          <span className="tag muted">{s.fail} missed</span>
        )}
      </div>

      <div className="period-headline">
        <span className="period-figure" style={{ color: clean ? 'var(--green)' : 'var(--red)' }}>{s.fail}</span>
        <span className="period-figure-label">of {s.total} service levels<br />missed target</span>
      </div>

      <div className="period-bar">
        {segments.map((seg) => (
          <span key={seg.key} style={{ flex: seg.n, background: seg.colour }} />
        ))}
      </div>
      <div className="period-legend">
        <span><i style={{ background: 'var(--green)' }} />{s.pass} met</span>
        <span><i style={{ background: 'var(--red)' }} />{s.fail} missed</span>
        {s.noData > 0 && <span><i style={{ background: 'var(--nodata)' }} />{s.noData} nothing completed</span>}
      </div>

      <div className="period-foot">
        <span className="row" style={{ gap: 6 }}>
          <IconClock /> {fmtCount(s.measured)} policies measured
        </span>
        <span>{s.openPastDeadline ? `${fmtCount(s.openPastDeadline)} overdue open` : 'nothing overdue'}</span>
      </div>
      <div className="period-stamp">
        {s.failing.length ? `Missed: ${s.failing.map((id) => labelOf[id] ?? id).join(', ')}` : 'Every service level with completed policies met target'}
      </div>
    </button>
  );
}
