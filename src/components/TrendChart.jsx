import { fmtRate } from '../lib/format.js';

const STATUS_COLOUR = { PASS: '#2e9e7b', FAIL: '#dc4c64', NO_DATA: '#9a94be' };
const CLIP_SPAN = 0.4; // values more than 40 pp below target are drawn clipped at the axis
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Split a series into runs of consecutive values, so a month with no data breaks the line. */
function runs(points, key) {
  const out = [];
  let cur = [];
  points.forEach((p, i) => {
    if (p[key] == null) {
      if (cur.length) out.push(cur);
      cur = [];
    } else cur.push({ i, v: p[key] });
  });
  if (cur.length) out.push(cur);
  return out;
}

/**
 * One service level's monthly rate across the history, drawn as inline SVG.
 *
 * The target is a line and everything below it is shaded as the failure region, so a month
 * dipping into the shading IS the finding. The solid line is Rate (completed), which decides
 * pass or fail; the dashed line is Rate incl. open, which also counts overdue open items.
 */
export default function TrendChart({ trend, height = 250 }) {
  const points = trend.points;
  const scored = points.filter((p) => p.rateCompleted != null);
  if (scored.length < 2) {
    return <div className="empty" style={{ padding: 40 }}><p>Not enough history to chart this service level yet.</p></div>;
  }

  const W = 760;
  const H = height;
  const pad = { top: 22, right: 18, bottom: 44, left: 58 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  // A month with one or two completed items can sit at 0% and flatten every other month into
  // a line along the top. Values far below target are therefore drawn clipped at the bottom
  // edge — still plotted, still labelled with their real value — rather than setting the axis.
  const clipBelow = trend.target - CLIP_SPAN;
  const values = [
    ...scored.map((p) => p.rateCompleted),
    ...points.filter((p) => p.rateInclOpen != null && !p.partial).map((p) => p.rateInclOpen),
    trend.target,
  ].filter((v) => v >= clipBelow);
  let min = Math.min(...values);
  let max = Math.min(1, Math.max(...values));
  const span = max - min || 0.02;
  min = Math.max(0, min - span * 0.12);
  max = Math.min(1.005, max + span * 0.12);

  const x = (i) => pad.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v) => pad.top + (1 - (Math.max(v, min) - min) / (max - min)) * innerH;
  const clipped = (v) => v < min;
  const path = (run) => run.map((p, k) => `${k === 0 ? 'M' : 'L'} ${x(p.i)} ${y(p.v)}`).join(' ');

  const yTarget = y(trend.target);
  const ticks = [min, trend.target, max].filter((v, i, a) => a.indexOf(v) === i);
  const inAxis = scored.filter((p) => !p.partial && !(p.rateCompleted < clipBelow));
  const worst = inAxis.reduce((a, b) => (b.rateCompleted < a.rateCompleted ? b : a), inAxis[0]);
  const last = [...scored].reverse().find((p) => !p.partial) ?? scored[scored.length - 1];

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img"
           aria-label={`${trend.label} monthly rate across ${points.length} months`}>
        {/* failure region: below target */}
        <rect x={pad.left} width={innerW} y={yTarget} height={Math.max(0, pad.top + innerH - yTarget)} fill="#dc4c64" opacity="0.07" />

        {/* target line */}
        <line x1={pad.left} x2={pad.left + innerW} y1={yTarget} y2={yTarget} stroke="#2e9e7b" strokeWidth="1.4" strokeDasharray="5 4" />
        {ticks.map((v) => (
          <text key={v} x={pad.left - 8} y={y(v) + 3.5} textAnchor="end" fontSize="11"
                fill={v === trend.target ? '#2e9e7b' : '#a8a2c6'} fontWeight={v === trend.target ? 700 : 500}>
            {fmtRate(v, v === trend.target ? 0 : 1)}
          </text>
        ))}

        <line x1={pad.left} x2={pad.left + innerW} y1={pad.top + innerH} y2={pad.top + innerH} stroke="#e8e5f8" strokeWidth="1" />

        {/* rate incl. open — the backlog view */}
        {runs(points, 'rateInclOpen').map((run, k) => (
          <path key={`o${k}`} d={path(run)} fill="none" stroke="#c9741a" strokeWidth="1.6" strokeDasharray="4 4" opacity="0.8" />
        ))}
        {/* rate (completed) — decides pass or fail */}
        {runs(points, 'rateCompleted').map((run, k) => (
          <path key={`c${k}`} d={path(run)} fill="none" stroke="#6e5be0" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        ))}

        {points.map((p, i) => {
          const [yy, mm] = p.month.split('-').map(Number);
          const showYear = i === 0 || mm === 1;
          return (
            <g key={p.month}>
              <text x={x(i)} y={pad.top + innerH + 16} textAnchor="middle" fontSize="10.5" fill={p.partial ? '#c9741a' : '#7b74a3'}>
                {MONTHS[mm - 1].slice(0, points.length > 14 ? 1 : 3)}
              </text>
              {showYear && (
                <text x={x(i)} y={pad.top + innerH + 31} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#4b4470">{yy}</text>
              )}
              {p.rateCompleted != null && clipped(p.rateCompleted) && (
                <text x={x(i)} y={y(p.rateCompleted) - 10} textAnchor="middle" fontSize="11" fontWeight="700" fill="#dc4c64">
                  ↓ {fmtRate(p.rateCompleted, 1)}
                </text>
              )}
              {p.rateCompleted != null && (
                <circle cx={x(i)} cy={y(p.rateCompleted)} r={p.partial ? 4.5 : 5}
                        fill={p.partial ? '#fff' : STATUS_COLOUR[p.status]} stroke={STATUS_COLOUR[p.status]}
                        strokeWidth={p.partial ? 2.2 : 1.5} strokeDasharray={p.partial ? '2 2' : undefined}>
                  <title>
                    {`${p.label}${p.partial ? ' (incomplete)' : ''}: ${fmtRate(p.rateCompleted)} completed, ${fmtRate(p.rateInclOpen)} incl. open · ${p.met} met, ${p.missed} missed, ${p.openPastDeadline} open overdue · ${p.status}`}
                  </title>
                </circle>
              )}
            </g>
          );
        })}

        {[worst, last].filter((p, i, a) => p && a.indexOf(p) === i && !clipped(p.rateCompleted)).map((p) => {
          const i = points.indexOf(p);
          return (
            <text key={`v${p.month}`} x={x(i)} y={y(p.rateCompleted) - 11} textAnchor="middle" fontSize="11.5" fontWeight="700" fill="#241d47">
              {fmtRate(p.rateCompleted, 1)}
            </text>
          );
        })}
      </svg>

      <div className="chart-legend">
        <span><i style={{ background: '#6e5be0' }} />Rate (completed)</span>
        <span><i style={{ background: '#c9741a' }} />Rate incl. open overdue</span>
        <span><i style={{ background: '#2e9e7b' }} />Target {fmtRate(trend.target, 0)}</span>
        <span><i className="band" style={{ background: 'rgba(220,76,100,0.14)' }} />Below target</span>
        <span><i className="band" style={{ background: '#fff', border: '1.5px dashed #9a94be' }} />Incomplete month</span>
      </div>
    </div>
  );
}
