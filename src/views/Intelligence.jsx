import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import TrendChart from '../components/TrendChart.jsx';
import NarrativeCard from '../components/NarrativeCard.jsx';
import { Status } from '../components/Chips.jsx';
import { DriversPanel } from './Position.jsx';
import { IconSpark, IconAlert, IconLayers, IconClock, IconCircleCheck } from '../components/Icons.jsx';
import { fmtRate, fmtTarget, fmtCount, fmtDay } from '../lib/format.js';

const BRIEF =
  'How each Schedule 23 service level has performed month by month, where its failures sit, and what was still overdue when the data source snapshot was taken.';

const recordStyle = (t) =>
  t.failMonths === 0
    ? { background: 'var(--green-bg)', color: 'var(--green)' }
    : t.failMonths / Math.max(1, t.observations) >= 0.5
      ? { background: 'var(--red-bg)', color: 'var(--red)' }
      : { background: 'var(--papaya)', color: '#c9741a' };

export default function Intelligence({ open, onClose, version }) {
  const [scope, setScope] = useState('all');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [slaId, setSlaId] = useState(null);
  const [error, setError] = useState(null);
  // Increments on each open, so the header animation replays without unmounting on close.
  const [openCount, setOpenCount] = useState(0);

  useEffect(() => {
    if (open) setOpenCount((n) => n + 1);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.intelligence(scope)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        // Default the chart to the service level that missed target most often.
        const worst = [...(d.trends ?? [])].filter((t) => !t.parent).sort((a, b) => b.failMonths - a.failMonths)[0];
        setSlaId((cur) => (cur && d.trends.some((t) => t.id === cur) ? cur : worst?.id ?? d.trends?.[0]?.id ?? null));
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [open, scope, version]);

  // Escape closes the panel — expected of anything that behaves like a drawer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const trend = useMemo(() => data?.trends?.find((t) => t.id === slaId) ?? null, [data, slaId]);
  const allMonths = data?.allMonths ?? data?.months ?? [];

  return (
    <>
      <div className={`intel-scrim${open ? ' is-open' : ''}`} onClick={onClose} />
      <section className={`intel-panel${open ? ' is-open' : ''}`} aria-hidden={!open}>
        <header className="intel-header">
          <button className="intel-back" onClick={onClose} title="Back to governance (Esc)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 6l6 6-6 6M20 12H4" />
            </svg>
            Governance
          </button>

          {/* Keyed on the open count: remounting replays the entrance on every open while the
              header stays on screen through the slide-out. */}
          <div className="intel-badge" key={`badge-${openCount}`}>
            <IconSpark size={17} />
            <span className="intel-badge-title">Operational Intelligence</span>
          </div>
          <p className="intel-brief" key={`brief-${openCount}`}>{BRIEF}</p>
        </header>

        <div className="intel-body">
          {/* -------------------------------------------------- scope */}
          {data && !data.empty && (
            <div className="scope-bar">
              <button className={`scope-chip${scope === 'all' ? ' is-active' : ''}`} onClick={() => setScope('all')}>
                All history
              </button>
              <select
                className="metric-select"
                value={scope === 'all' ? '' : scope}
                onChange={(e) => setScope(e.target.value || 'all')}
                aria-label="Read the history up to a month"
              >
                <option value="">Up to a month…</option>
                {[...allMonths].reverse().map((m) => (
                  <option key={m.month} value={m.month}>Up to {m.label}{m.partial ? ' (incomplete)' : ''}</option>
                ))}
              </select>
            </div>
          )}

          {loading && !data && <div className="empty" style={{ paddingTop: 60 }}><span className="spinner" /></div>}
          {error && (
            <div className="card empty">
              <div className="empty-icon"><IconAlert size={26} /></div>
              <h3>Could not build the intelligence view</h3>
              <p>{error}</p>
            </div>
          )}

          {data?.empty && (
            <div className="card empty">
              <div className="empty-icon"><IconLayers size={26} /></div>
              <h3>No history to analyse yet</h3>
              <p>Load the data sources and the trend, driver and backlog panels will populate.</p>
            </div>
          )}

          {data && !data.empty && (
            <>
              {/* ------------------------------------------------- headline */}
              <div className="stat-row">
                <Stat label="Periods analysed" value={data.headline.monthsAnalysed} note={`${data.months[0].label} to ${data.focusLabel}`} accent="violet" />
                <Stat
                  label={`Missed target · ${data.latestFull.label}`}
                  value={`${data.headline.failingLatest} / ${data.headline.slaCount}`}
                  note={data.headline.failingLatestIds.length ? data.headline.failingLatestIds.map((id) => data.trends.find((t) => t.id === id)?.label).join(', ') : 'every service level met target'}
                  accent="red"
                />
                <Stat label="Months below target" value={data.headline.failMonths} note={`of ${data.headline.scoredMonths} service-level months scored`} accent="amber" />
                <Stat label="Open past deadline" value={fmtCount(data.headline.openPastDeadline)} note={`at the data source date, ${data.asOfLabel}`} accent="amber" />
              </div>

              {/* ------------------------------------------------ narrative */}
              <NarrativeCard data={data} scope={scope} />

              <div className="intel-grid">
                {/* ---------------------------------------------- trend */}
                <div className="card">
                  <div className="card-head">
                    <div className="trend-head" style={{ width: '100%' }}>
                      <div>
                        <h2>Monthly trend</h2>
                        <div className="sub">
                          {trend
                            ? `${trend.label} · target ${fmtTarget(trend.target)} · ${fmtRate(trend.window.rateCompleted)} across the window`
                            : 'Select a service level'}
                        </div>
                      </div>
                      <select className="metric-select" value={slaId ?? ''} onChange={(e) => setSlaId(e.target.value)}>
                        {data.trends.map((t) => <option key={t.id} value={t.id}>{t.parent ? '  ↳ ' : ''}{t.label} · {t.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="chart-wrap">
                    {trend ? <TrendChart trend={trend} /> : <p className="tiny muted">No service level selected.</p>}
                  </div>
                </div>

                {/* ----------------------------------------------- record */}
                <div className="card">
                  <div className="card-head">
                    <div>
                      <h2>Service level record</h2>
                      <div className="sub">Complete months below target, and the result across the whole window</div>
                    </div>
                  </div>
                  <div className="card-pad">
                    {data.trends.filter((t) => !t.parent).map((t) => (
                      <div key={t.id} className="risk-row" onClick={() => setSlaId(t.id)} style={{ cursor: 'pointer' }}>
                        <div className="risk-score" style={recordStyle(t)} title="Complete months below target">{t.failMonths}</div>
                        <div>
                          <span className="risk-name">{t.label} · {t.name}</span>
                          <div className="risk-why">
                            Missed in {t.failMonths} of {t.observations} complete months
                            {t.failStreak > 1 ? ` · the last ${t.failStreak} in a row` : ''}
                            {t.worst ? ` · weakest ${t.worst.label} at ${fmtRate(t.worst.rateCompleted)} (${fmtCount(t.worst.met + t.worst.missed)} completed ${t.worst.met + t.worst.missed === 1 ? 'policy' : 'policies'})` : ''}
                          </div>
                          <div className="months-strip" title="Complete months: red = below target">
                            {t.points.filter((p) => !p.partial && p.status !== 'NO_DATA').map((p) => (
                              <i key={p.month} className={p.status === 'FAIL' ? 'hit' : ''} title={`${p.label}: ${fmtRate(p.rateCompleted)}`} />
                            ))}
                          </div>
                        </div>
                        <div className="risk-figures">
                          <div className="risk-projection">{fmtRate(t.window.rateCompleted)}</div>
                          <div className="tiny muted" style={{ marginTop: 3 }}>window vs {fmtRate(t.target, 0)}</div>
                          <div style={{ marginTop: 5 }} title="Across the whole window"><Status status={t.window.status} compact /></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* ------------------------------------------- drivers */}
              <div className="card">
                <div className="card-head">
                  <div>
                    <h2>Where failures concentrate</h2>
                    <div className="sub">
                      Handlers, products and transaction types failing at 1.25× their service level’s rate or more across the window
                    </div>
                  </div>
                  <span className="tag warm">{data.drivers.length} found</span>
                </div>
                <div className="card-pad"><DriversPanel drivers={data.drivers} slas={data.trends} limit={8} /></div>
              </div>

              {/* ----------------------------------------------- backlog */}
              <div className="card">
                <div className="card-head">
                  <div>
                    <h2>Overdue backlog · {data.asOfLabel}</h2>
                    <div className="sub">Policies still open past their deadline when the data source snapshot was taken — outside the pass/fail rate, each a miss in waiting</div>
                  </div>
                </div>
                <div className="card-pad">
                  {data.backlog.length === 0 ? (
                    <div className="row" style={{ gap: 10, color: 'var(--green)' }}>
                      <IconCircleCheck size={18} />
                      <span className="tiny" style={{ color: 'var(--ink-2)' }}>Nothing open past its deadline.</span>
                    </div>
                  ) : (
                    <div className="demand-row">
                      {data.backlog.map((b) => (
                        <div key={b.id} className="demand-card">
                          <div className="demand-label">{b.label}</div>
                          <div className="demand-value">{fmtCount(b.count)}</div>
                          <div className="demand-change up">oldest due {fmtDay(b.oldestDeadline)}</div>
                          <div className="demand-note">{b.daysOverdue} days overdue · {b.name}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="row" style={{ justifyContent: 'center', paddingTop: 4 }}>
                <span className="tiny muted row" style={{ gap: 7 }}>
                  <IconClock />
                  Computed from {data.headline.monthsAnalysed} monthly packs · {fmtCount(data.headline.measured)} policies measured · every figure derived by rule, nothing projected
                </span>
              </div>
            </>
          )}
        </div>
      </section>
    </>
  );
}

function Stat({ label, value, note, accent }) {
  return (
    <div className={`stat accent-${accent}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-note">{note}</div>
    </div>
  );
}
