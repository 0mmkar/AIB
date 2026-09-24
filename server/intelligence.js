import { loadSchedule } from './engine/engine.js';
import { OUTCOME } from './engine/outcome.js';
import { listMonths, readAnalysis, readSnapshot, dayLabel } from './store.js';
import { missDrivers, isMeasured } from './insights.js';

/**
 * Operational intelligence over the stored monthly packs — descriptive only.
 *
 * Everything here is a count or a ratio of items the engine has already judged: the rate
 * each SLA achieved month by month, how often it met target, where its failures sit, and
 * what was still overdue at the extract date. Nothing is projected forward; the data does
 * not define a forecast, so none is made.
 */

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const rate = (n, d) => (d ? n / d : null);

/** Every generated pack, oldest first. */
export function loadHistory() {
  return listMonths()
    .map((m) => readAnalysis(m))
    .filter(Boolean)
    .sort((a, b) => a.reporting_month.localeCompare(b.reporting_month));
}

function trendFor(def, window, latestFull) {
  const points = window.map((h) => {
    const r = h.results.find((x) => x.id === def.id);
    return {
      month: h.reporting_month,
      label: h.label,
      partial: h.partial,
      rateCompleted: r?.rateCompleted ?? null,
      rateInclOpen: r?.rateInclOpen ?? null,
      status: r?.status ?? 'NO_DATA',
      met: r?.met ?? 0,
      missed: r?.missed ?? 0,
      openPastDeadline: r?.openPastDeadline ?? 0,
      openNotYetDue: r?.openNotYetDue ?? 0,
    };
  });

  const complete = points.filter((p) => !p.partial && p.status !== 'NO_DATA');
  let failStreak = 0;
  for (let i = complete.length - 1; i >= 0 && complete[i].status === 'FAIL'; i--) failStreak++;

  const met = sum(points.map((p) => p.met));
  const missed = sum(points.map((p) => p.missed));
  const openPastDeadline = sum(points.map((p) => p.openPastDeadline));
  const windowRate = rate(met, met + missed);
  const ranked = [...complete].sort((a, b) => a.rateCompleted - b.rateCompleted);

  return {
    id: def.id,
    label: def.label,
    name: def.name,
    parent: def.parent ?? null,
    target: def.target,
    statement: def.statement,
    points,
    observations: complete.length,
    passMonths: complete.filter((p) => p.status === 'PASS').length,
    failMonths: complete.filter((p) => p.status === 'FAIL').length,
    failStreak,
    window: {
      met,
      missed,
      openPastDeadline,
      rateCompleted: windowRate,
      rateInclOpen: rate(met, met + missed + openPastDeadline),
      status: windowRate == null ? 'NO_DATA' : windowRate >= def.target - 1e-12 ? 'PASS' : 'FAIL',
    },
    latest: points.find((p) => p.month === latestFull?.month) ?? null,
    worst: ranked[0] ?? null,
    best: ranked[ranked.length - 1] ?? null,
  };
}

/** Items still open past their deadline at the extract date, by SLA. */
function backlogOf(items, schedule, asOf) {
  const leaves = schedule.slas.filter((s) => !s.parts);
  const overdue = items.filter((i) => i.outcome === OUTCOME.OPEN_PAST);
  return leaves
    .map((def) => {
      const mine = overdue.filter((i) => i.sla === def.id);
      const oldest = mine.reduce((min, i) => (!min || i.deadline < min ? i.deadline : min), null);
      const daysOverdue = oldest && asOf ? Math.round((Date.parse(asOf) - Date.parse(oldest)) / 86400000) : null;
      const byMonth = {};
      for (const i of mine) byMonth[i.month] = (byMonth[i.month] || 0) + 1;
      return { id: def.id, label: def.label, name: def.name, count: mine.length, oldestDeadline: oldest, oldestDeadlineLabel: dayLabel(oldest), daysOverdue, byMonth };
    })
    .filter((b) => b.count > 0)
    .sort((a, b) => b.count - a.count);
}

/**
 * `scope` is 'all' or a month key; a month narrows the window to that month and everything
 * before it, so a past period is read with the history that existed up to it.
 */
export function buildIntelligence({ scope = 'all' } = {}) {
  const history = loadHistory();
  const window = scope === 'all' ? history : history.filter((h) => h.reporting_month <= scope);
  const snapshot = readSnapshot();
  if (!window.length) return { scope, months: [], trends: [], drivers: [], backlog: [], empty: true };

  const schedule = loadSchedule();
  const focus = window[window.length - 1];
  const fullMonths = window.filter((h) => !h.partial);
  const latestFull = (fullMonths[fullMonths.length - 1] ?? focus);
  const latestFullRef = { month: latestFull.reporting_month, label: latestFull.label };

  const trends = schedule.slas.map((def) => trendFor(def, window, latestFullRef));
  const headlineTrends = trends.filter((t) => !t.parent);
  const items = window.flatMap((h) => h.items ?? []);
  const backlog = backlogOf(items, schedule, snapshot?.as_of);

  return {
    scope,
    empty: false,
    asOf: snapshot?.as_of ?? null,
    asOfLabel: snapshot?.as_of_label ?? null,
    months: window.map((h) => ({ month: h.reporting_month, label: h.label, partial: h.partial })),
    allMonths: history.map((h) => ({ month: h.reporting_month, label: h.label, partial: h.partial })),
    focusLabel: focus.label,
    focusPartial: focus.partial,
    latestFull: latestFullRef,
    trends,
    drivers: missDrivers(items, { minItems: 5, minFailures: 3, limit: 10 }),
    backlog,
    headline: {
      monthsAnalysed: window.length,
      slaCount: headlineTrends.length,
      passingLatest: headlineTrends.filter((t) => t.latest?.status === 'PASS').length,
      failingLatest: headlineTrends.filter((t) => t.latest?.status === 'FAIL').length,
      failingLatestIds: headlineTrends.filter((t) => t.latest?.status === 'FAIL').map((t) => t.id),
      failMonths: sum(headlineTrends.map((t) => t.failMonths)),
      scoredMonths: sum(headlineTrends.map((t) => t.observations)),
      openPastDeadline: sum(backlog.map((b) => b.count)),
      measured: items.filter(isMeasured).length,
    },
  };
}
