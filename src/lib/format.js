/** A rate held as a 0..1 fraction, shown the way the SLA workbook shows it: 97.28%. */
export function fmtRate(v, dp = 2) {
  if (v == null) return '—';
  return `${(v * 100).toFixed(dp)}%`;
}

/** Target as a threshold: "≥ 97%". Targets are whole percentages in the schedule. */
export const fmtTarget = (target) => `≥ ${fmtRate(target, target * 100 % 1 ? 1 : 0)}`;

/** Distance from target in percentage points, signed: "+1.28 pp" / "−0.39 pp". */
export function fmtGap(rate, target) {
  if (rate == null) return '—';
  const pp = (rate - target) * 100;
  const sign = pp >= 0 ? '+' : '−';
  return `${sign}${Math.abs(pp).toFixed(2)} pp`;
}

export const fmtCount = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IE'));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-08-13' → '13 Aug 2026'; '2026-08-13T09:38:09' → '13 Aug 2026 09:38'. */
export function fmtDay(iso) {
  if (!iso) return '—';
  const [d, t] = String(iso).split('T');
  const [y, m, day] = d.split('-').map(Number);
  const out = `${day} ${MONTHS[m - 1]} ${y}`;
  return t ? `${out} ${t.slice(0, 5)}` : out;
}

export const fmtMonthShort = (monthKey) => {
  const [y, m] = monthKey.split('-').map(Number);
  return `${MONTHS[m - 1]} ${String(y).slice(2)}`;
};

export function fmtHours(h) {
  if (h == null) return '—';
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  return `${whole}h ${String(mins).padStart(2, '0')}m`;
}

export function fmtBytes(n) {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

export function fmtStamp(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleString('en-IE', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export function relativeTime(iso) {
  if (!iso) return null;
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 45) return 'just now';
  if (secs < 3600) return `${Math.round(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)} hr ago`;
  return `${Math.round(secs / 86400)} d ago`;
}

/**
 * Where a rate sits on the inline bar: the target mark is fixed at the centre, and the bar
 * spans five percentage points either side, so a 1 pp miss is visibly short of the mark.
 */
export function progressOf(rate, target) {
  if (rate == null) return 0;
  return Math.max(0, Math.min(1, 0.5 + (rate - target) * 10));
}

export const plural = (n, one, many = `${one}s`) => `${fmtCount(n)} ${n === 1 ? one : many}`;
