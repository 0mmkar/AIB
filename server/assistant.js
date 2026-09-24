import { bedrockText, unsupportedFigures, bedrockAvailable, activeModel, brief, slaFacts, driverFacts, pct } from './narrative.js';

/**
 * A Q&A layer over the computed intelligence — not a general-purpose assistant.
 *
 * It answers questions about THIS report using only figures the engine has already
 * computed. No tools, no retrieval, no conversation memory, no outside knowledge. The same
 * fabrication guard as the narrative applies: an answer quoting a figure absent from its own
 * context is discarded in favour of the deterministic one.
 */

// Words too generic to identify a service level on their own.
const STOP = new Set([
  'the', 'is', 'are', 'was', 'why', 'what', 'which', 'how', 'and', 'for', 'our', 'this', 'that',
  'did', 'does', 'fail', 'failed', 'failing', 'pass', 'passed', 'sla', 'slas', 'target', 'month',
  'months', 'we', 'it', 'in', 'on', 'at', 'of', 'to', 'a', 'an', 'about', 'tell', 'me', 'show',
  'explain', 'where', 'worst', 'report', 'rate', 'service', 'level', 'levels', 'items', 'many',
]);

const tokens = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));

/** How people refer to each service level in a governance meeting. */
const ALIASES = {
  '23A': ['23a', 'policy issue', 'issue policy', 'issuance', 'new business'],
  '23B_NUL': ['23b nul', 'nul', 'non unit linked', 'alteration', 'alterations'],
  '23B_UL': ['23b ul', 'ul', 'unit linked', 'unit'],
  '23B_UL_S1': ['step 1', 'step1', 'ebq unit linked'],
  '23B_UL_S2': ['step 2', 'step2', 'withdrawal', 'withdrawals'],
  '23B_UL_S3': ['step 3', 'step3', 'unit adjustment', 'adjustments'],
  '23C': ['23c', 'cancellation', 'cancellations', 'cancel'],
  '23E': ['23e', 'eft', 'unrecognised', 'payment', 'payments', 'manual review'],
};

/**
 * Which service level is the question about?
 *
 * Terms are weighted by how many service levels they belong to, so a term unique to one
 * ("cancellation", "eft") is decisive and a shared one ("23b", "unit") barely counts.
 * Returns null when nothing scores well enough — answering generally beats answering
 * confidently about the wrong service level.
 */
export function resolveSla(question, trends) {
  const qt = tokens(question);
  if (!qt.length) return null;

  const vocab = trends.map((t) => ({
    trend: t,
    terms: new Set([...tokens(t.label), ...tokens(t.name), ...(ALIASES[t.id] ?? []).flatMap(tokens)]),
  }));
  const spread = new Map();
  for (const v of vocab) for (const term of v.terms) spread.set(term, (spread.get(term) ?? 0) + 1);

  let best = null;
  for (const v of vocab) {
    let score = 0;
    for (const t of qt) {
      const hit = [...v.terms].some((x) => x === t || (t.length > 3 && x.startsWith(t)) || (x.length > 3 && t.startsWith(x)));
      if (hit) score += 1 / (spread.get(t) ?? 1);
    }
    if (score > 0 && (!best || score > best.score)) best = { trend: v.trend, score };
  }
  return best && best.score >= 0.5 ? best.trend : null;
}

/** The grounding context handed to the model — computed figures only. */
function buildContext(intel, question) {
  const base = brief(intel);
  const t = resolveSla(question, intel.trends);
  if (!t) return { ...base, questionAboutSpecificSla: false };

  return {
    ...base,
    questionAboutSpecificSla: true,
    slaInQuestion: {
      ...slaFacts(t),
      statement: t.statement,
      historyByMonth: t.points
        .filter((p) => p.status !== 'NO_DATA' || p.openPastDeadline)
        .map((p) => ({
          month: p.label,
          incomplete: p.partial,
          rateCompleted: pct(p.rateCompleted),
          status: p.status,
          met: p.met,
          missed: p.missed,
          openPastDeadline: p.openPastDeadline,
        })),
      whereFailuresConcentrate: intel.drivers.filter((d) => d.sla === t.id).map((d) => driverFacts(d, intel)),
      openPastDeadline: intel.backlog.find((b) => b.id === t.id) ?? null,
    },
  };
}

// --------------------------------------------------------------- rules answer

/** Deterministic answer — runs whenever Bedrock is unavailable or fails the guard. */
export function composeAnswer(intel, question) {
  const t = resolveSla(question, intel.trends);
  const latest = intel.latestFull.label;

  if (!t) {
    const failing = intel.trends.filter((x) => !x.parent && x.latest?.status === 'FAIL');
    return (
      `This report covers ${intel.headline.monthsAnalysed} periods to ${intel.focusLabel}. ` +
      `In ${latest}, ${intel.headline.passingLatest} of ${intel.headline.slaCount} service levels met target` +
      (failing.length ? `; ${failing.map((x) => `${x.label} (${pct(x.latest.rateCompleted)} against ${pct(x.target)})`).join(', ')} did not. ` : '. ') +
      `${intel.headline.openPastDeadline.toLocaleString('en-IE')} items were open past deadline at the extract date. ` +
      `Ask about a service level by code (23A, 23B NUL, 23B UL, 23C, 23E) for its history and where its failures sit.`
    );
  }

  const parts = [];
  parts.push(
    `${t.label} (${t.name}) targets ${pct(t.target)}. ` +
      (t.latest && t.latest.status !== 'NO_DATA'
        ? `In ${latest} it achieved ${pct(t.latest.rateCompleted)} — ${t.latest.status === 'PASS' ? 'met' : 'missed'} (${t.latest.met} met, ${t.latest.missed} missed). `
        : `It has no completed items in ${latest}. `) +
      `Across the window it failed ${t.failMonths} of ${t.observations} complete months, ${pct(t.window.rateCompleted)} overall.`,
  );
  if (t.worst) parts.push(`Its weakest complete month was ${t.worst.label} at ${pct(t.worst.rateCompleted)}.`);

  const drivers = intel.drivers.filter((d) => d.sla === t.id).slice(0, 2);
  if (drivers.length) {
    parts.push(
      `Failures concentrate in ` +
        drivers.map((d) => `${d.key} (${d.dimensionLabel.toLowerCase()}: ${d.failures} failures, ${d.failRatePct}% against ${d.slaFailRatePct}% overall)`).join(' and ') +
        '.',
    );
  }
  const b = intel.backlog.find((x) => x.id === t.id);
  if (b) parts.push(`${b.count} of its items were open past deadline at the extract date, the oldest due ${b.oldestDeadlineLabel}.`);
  return parts.join(' ');
}

// ------------------------------------------------------------- model answer

const SYSTEM_PROMPT = `You answer questions about one SLA governance report for an Irish life assurance business, covering the Schedule 23 service levels (23A, 23B NUL, 23B UL and its steps, 23C, 23E) measured from TCS BaNCS extracts.

You are given figures ALREADY COMPUTED by a deterministic engine. Answer only from them.

Rules:
- Never state a number that is not in the context. Never recompute, re-round or estimate.
- Pass or fail is decided by rateCompleted against target; open items past deadline are reported separately.
- Never forecast or predict.
- 2 to 4 sentences. No headings, no bullets, no preamble, no sign-off.
- "Why did X fail" is answered from slaInQuestion: its historyByMonth, whereFailuresConcentrate and openPastDeadline.
- If the context does not contain the answer, say so plainly in one sentence and name what the report covers.
- If the question is not about this SLA report, say that you only cover this report.
- Never use "only", "sole" or "the single" about a count unless that count is exactly 1.
- British/Irish English. Plain and direct.`;

export async function askAssistant(intel, question, { allowModel = true } = {}) {
  const trimmed = String(question ?? '').trim();
  if (!trimmed) return { answer: 'Ask a question about this report.', source: 'rules' };

  const matched = resolveSla(trimmed, intel.trends);
  const grounding = { matchedSla: matched ? `${matched.label} · ${matched.name}` : null };

  if (allowModel && bedrockAvailable()) {
    const context = buildContext(intel, trimmed);
    try {
      const text = await bedrockText({
        system: SYSTEM_PROMPT,
        user: `Report context:\n${JSON.stringify(context, null, 2)}\n\nQuestion: ${trimmed}`,
        maxTokens: 500,
        temperature: 0.15,
      });
      if (!text) throw new Error('empty answer');
      const invented = unsupportedFigures(text, context);
      if (invented.length) throw new Error(`answer quoted figures absent from the report: ${invented.join(', ')}`);
      return { answer: text, source: 'bedrock', model: activeModel(), ...grounding };
    } catch (err) {
      return { answer: composeAnswer(intel, trimmed), source: 'rules', fallbackReason: err.message, ...grounding };
    }
  }

  return { answer: composeAnswer(intel, trimmed), source: 'rules', ...grounding };
}

/** Starter questions, built from what this report actually contains. */
export function suggestedQuestions(intel) {
  const out = [];
  const failing = intel.trends.filter((t) => !t.parent && t.latest?.status === 'FAIL');
  if (failing[0]) out.push(`Why did ${failing[0].label} miss target in ${intel.latestFull.label}?`);
  const chronic = [...intel.trends].filter((t) => !t.parent).sort((a, b) => b.failMonths - a.failMonths)[0];
  if (chronic && chronic.id !== failing[0]?.id && chronic.failMonths) out.push(`How often has ${chronic.label} failed?`);
  if (intel.drivers[0]) {
    const sla = intel.trends.find((t) => t.id === intel.drivers[0].sla)?.label;
    out.push(`Where are the ${sla} failures concentrated?`);
  }
  if (intel.headline.openPastDeadline) out.push('How many items are open past deadline?');
  return out.slice(0, 4);
}
