import { addDays, dayOf, weekdayOf } from './datetime.js';

/**
 * The business calendar every Schedule 23 deadline is measured on.
 *
 * Weekends and the listed Irish public holidays are not business days. A clock that starts
 * on one of them starts on the next business day and counts as before the cut-off — so a
 * Saturday creation is due on Monday under a same-day rule, not Tuesday.
 */
export function makeCalendar({ holidays = [], cutoffHour = 15 } = {}) {
  const closed = new Set(holidays);

  const isBusinessDay = (day) => {
    const wd = weekdayOf(day);
    return wd !== 0 && wd !== 6 && !closed.has(day);
  };

  const nextBusinessDay = (day) => {
    let d = addDays(day, 1);
    while (!isBusinessDay(d)) d = addDays(d, 1);
    return d;
  };

  /** Day the clock starts on, and whether it started before the cut-off. */
  const clockStart = (stamp) => {
    const day = dayOf(stamp);
    if (!isBusinessDay(day)) return { day: nextBusinessDay(day), beforeCutoff: true };
    return { day, beforeCutoff: stamp.getUTCHours() < cutoffHour };
  };

  /** Business days from one day to another, not counting the start day. */
  const businessDaysBetween = (from, to) => {
    if (to <= from) return 0;
    let n = 0;
    for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) if (isBusinessDay(d)) n++;
    return n;
  };

  return {
    isBusinessDay,
    nextBusinessDay,
    clockStart,
    businessDaysBetween,
    /** Same business day as the clock start. */
    sameDay: (stamp) => clockStart(stamp).day,
    /** End of the business day after the clock start. */
    nextDay: (stamp) => nextBusinessDay(clockStart(stamp).day),
    /** The 3 pm rule: before the cut-off → same business day; at or after → the next one. */
    cutoffRule: (stamp) => {
      const c = clockStart(stamp);
      return c.beforeCutoff ? c.day : nextBusinessDay(c.day);
    },
  };
}
