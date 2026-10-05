import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { DATA_DIR } from './store.js';

/**
 * Executive insight narrative over the Schedule 23 figures.
 *
 * Two layers:
 *
 *   RULES     a deterministic summary composed from the computed rates, pass/fail record,
 *             failure concentration and backlog. Always available, cannot hallucinate.
 *   BEDROCK   a model given those same computed figures and asked to phrase them for a
 *             governance lead.
 *
 * The model is handed the arithmetic and asked to phrase it — never to work out what the
 * numbers are. A reply that quotes any figure absent from its input is discarded in favour
 * of the rules version.
 *
 * Results are cached on disk keyed by a hash of the inputs, so a presentation never depends
 * on a live API call.
 */

const CACHE_DIR = path.join(DATA_DIR, 'narratives');

/**
 * Bedrock serves two families through different APIs:
 *
 *   amazon.nova-*     Amazon's own models, via the Converse API.
 *   anthropic.*       Claude, via the Anthropic Bedrock SDK — a marketplace model that also
 *                     needs a valid payment instrument on the AWS account, otherwise every
 *                     call returns 403 INVALID_PAYMENT_INSTRUMENT.
 *
 * The model id selects the path, so switching provider is a one-line .env change.
 */
const BEDROCK_MODEL = process.env.BEDROCK_MODEL_ID || 'amazon.nova-pro-v1:0';
const isNova = (id) => /(^|\.)amazon\.nova/.test(id);

const sharedCredentialsFile = () =>
  process.env.AWS_SHARED_CREDENTIALS_FILE ||
  path.join(process.env.HOME || process.env.USERPROFILE || '', '.aws', 'credentials');

/** Credentials in the environment, a profile, or ~/.aws/credentials all count. */
const hasBedrockCredentials = () =>
  Boolean(
    (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) ||
      process.env.AWS_PROFILE ||
      process.env.AWS_ROLE_ARN ||
      fs.existsSync(sharedCredentialsFile()),
  );

export const credentialSource = () =>
  process.env.AWS_ACCESS_KEY_ID ? 'environment'
    : process.env.AWS_PROFILE ? `profile:${process.env.AWS_PROFILE}`
    : fs.existsSync(sharedCredentialsFile()) ? 'shared credentials file'
    : 'none';

const fingerprint = (payload) =>
  crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);

function readCache(key) {
  const p = path.join(CACHE_DIR, `${key}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(key, value) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(value, null, 2) + '\n');
  return value;
}

// ------------------------------------------------------------------ shaping

export const pct = (v) => (v == null ? 'no data' : `${(Math.round(v * 10000) / 100).toFixed(2)}%`);
const n = (v) => Number(v).toLocaleString('en-IE');
const verb = (count, one, many) => (count === 1 ? one : many);

const RESULT_WORDS = { PASS: 'MET TARGET', FAIL: 'MISSED TARGET', NO_DATA: 'NO COMPLETED ITEMS' };
const resultOf = (status) => RESULT_WORDS[status] ?? RESULT_WORDS.NO_DATA;

/** Compact figures for one SLA, as both layers quote them. */
export function slaFacts(t) {
  return {
    sla: t.label,
    name: t.name,
    target: pct(t.target),
    inLatestCompleteMonth: t.latest
      ? { result: resultOf(t.latest.status), rateCompleted: pct(t.latest.rateCompleted), itemsMet: t.latest.met, itemsMissed: t.latest.missed }
      : null,
    acrossWholeWindow: {
      result: resultOf(t.window.status),
      rateCompleted: pct(t.window.rateCompleted),
      rateIncludingOverdueOpenItems: pct(t.window.rateInclOpen),
      met: t.window.met,
      missed: t.window.missed,
      openPastDeadline: t.window.openPastDeadline,
    },
    completeMonthsScored: t.observations,
    completeMonthsFailed: t.failMonths,
    consecutiveCompleteMonthsFailingUpToLatest: t.failStreak,
    worstCompleteMonth: t.worst
      ? { month: t.worst.label, rateCompleted: pct(t.worst.rateCompleted), completedItemsThatMonth: t.worst.met + t.worst.missed }
      : null,
  };
}

export const driverFacts = (d, intel) => ({
  sla: intel.trends.find((t) => t.id === d.sla)?.label ?? d.sla,
  dimension: d.dimensionLabel,
  group: d.key,
  failures: d.failures,
  missed: d.missed,
  openPastDeadline: d.openPastDeadline,
  groupFailRate: `${d.failRatePct}%`,
  slaFailRate: `${d.slaFailRatePct}%`,
  shareOfSlaFailures: `${d.sharePct}%`,
  shareOfSlaVolume: `${d.volumeSharePct}%`,
});

/** The service level(s) that missed target in the most complete months — ties included. */
function failedMostOften(headline) {
  const max = Math.max(0, ...headline.map((t) => t.failMonths));
  if (!max) return [];
  return headline
    .filter((t) => t.failMonths === max)
    .map((t) => ({ sla: t.label, completeMonthsMissed: t.failMonths, completeMonthsScored: t.observations }));
}

/**
 * The compact, already-computed brief both layers work from.
 *
 * Which service levels met or missed target is spelt out as explicit lists rather than left
 * to be read off per-SLA status fields: a model reading the per-SLA fields put a service
 * level that passed into the list of failures.
 */
export function brief(intel) {
  const headline = intel.trends.filter((t) => !t.parent);
  const inLatest = (status) =>
    headline
      .filter((t) => t.latest?.status === status)
      .map((t) => ({ sla: t.label, rateCompleted: pct(t.latest.rateCompleted), target: pct(t.target) }));
  return {
    window: `${intel.months[0]?.label} to ${intel.focusLabel}`,
    periodsAnalysed: intel.headline.monthsAnalysed,
    extractTakenOn: intel.asOfLabel,
    latestMonthIsIncomplete: intel.focusPartial ? intel.focusLabel : null,
    slaCount: headline.length,
    latestCompleteMonth: {
      month: intel.latestFull.label,
      metTarget: inLatest('PASS'),
      missedTarget: inLatest('FAIL'),
      noCompletedItems: headline.filter((t) => !t.latest || t.latest.status === 'NO_DATA').map((t) => t.label),
    },
    missedTargetInMostCompleteMonths: failedMostOften(headline),
    slas: headline.map(slaFacts),
    unitLinkedSteps: intel.trends.filter((t) => t.parent).map(slaFacts),
    whereFailuresConcentrate: intel.drivers.slice(0, 4).map((d) => driverFacts(d, intel)),
    openPastDeadlineAtExtractDate: {
      total: intel.headline.openPastDeadline,
      bySla: intel.backlog.slice(0, 4).map((b) => ({ sla: b.label, items: b.count, oldestDeadline: b.oldestDeadlineLabel })),
    },
  };
}

// ------------------------------------------------------------------- rules

/**
 * Deterministic narrative — the version that runs whenever Bedrock is unavailable, so it has
 * to stand on its own in front of a governance audience.
 */
export function composeNarrative(intel) {
  const headline = intel.trends.filter((t) => !t.parent);
  const paras = [];
  const latest = intel.latestFull.label;

  // 1. Position in the latest complete month.
  const failing = headline.filter((t) => t.latest?.status === 'FAIL');
  const passing = headline.filter((t) => t.latest?.status === 'PASS');
  paras.push(
    `In ${latest}, ${passing.length} of ${headline.length} Schedule 23 service levels met target` +
      (failing.length
        ? `. ${failing.length} fell short: ${failing.map((t) => `${t.label} at ${pct(t.latest.rateCompleted)} against ${pct(t.target)}`).join('; ')}.`
        : ', with none below target.') +
      (intel.focusPartial ? ` ${intel.focusLabel} is still incomplete at the extract date (${intel.asOfLabel}) and is read separately.` : ''),
  );

  // 2. The record across the window.
  const chronic = [...headline].filter((t) => t.failMonths > 0).sort((a, b) => b.failMonths - a.failMonths);
  if (chronic.length) {
    const top = chronic[0];
    const steady = headline.filter((t) => t.window.status === 'PASS');
    paras.push(
      `Across ${intel.headline.monthsAnalysed} periods (${intel.months[0].label} to ${intel.focusLabel}), ${top.label} missed target in ${top.failMonths} of ${top.observations} complete months` +
        (top.failStreak > 1 ? `, including the last ${top.failStreak} in a row` : '') +
        `, for ${pct(top.window.rateCompleted)} overall against ${pct(top.target)}. ` +
        (steady.length
          ? `${steady.map((t) => t.label).join(', ')} ${verb(steady.length, 'meets', 'meet')} target over the window as a whole.`
          : 'No service level meets target over the window as a whole.'),
    );
  }

  // 3. Where the failures sit.
  const d = intel.drivers[0];
  if (d) {
    const sla = intel.trends.find((t) => t.id === d.sla)?.label ?? d.sla;
    const second = intel.drivers.find((x) => x.sla !== d.sla || x.dimension !== d.dimension);
    paras.push(
      `Failures are concentrated rather than spread evenly: on ${sla}, ${d.dimensionLabel.toLowerCase()} ${d.key} accounts for ${n(d.failures)} failures, ` +
        `a ${d.failRatePct}% failure rate against ${d.slaFailRatePct}% for the service level as a whole` +
        (second
          ? `. ${second.key} (${second.dimensionLabel.toLowerCase()}, ${intel.trends.find((t) => t.id === second.sla)?.label ?? second.sla}) follows with ${n(second.failures)} at ${second.failRatePct}%.`
          : '.'),
    );
  }

  // 4. What was still overdue when the extract was taken.
  if (intel.headline.openPastDeadline > 0) {
    const top = intel.backlog.slice(0, 3);
    paras.push(
      `At the extract date (${intel.asOfLabel}), ${n(intel.headline.openPastDeadline)} items were still open past their deadline — ` +
        `${top.map((b) => `${n(b.count)} on ${b.label}`).join(', ')}. ` +
        `They sit outside the completed-item rate that decides pass or fail, but each is a miss in waiting.`,
    );
  }

  return paras.join('\n\n');
}

// ----------------------------------------------------------------- bedrock

const SYSTEM_PROMPT = `You write the executive summary at the top of a monthly SLA governance pack for an Irish life assurance business, covering the Schedule 23 service levels measured from TCS BaNCS extracts.

You are given figures that have ALREADY been calculated by a deterministic engine. Your job is to phrase them, not to compute or infer anything new.

Rules:
- Never state a number that is not in the input. Never round differently, recompute or estimate.
- Pass or fail is decided by rateCompleted against target. Open items past deadline are NOT in that rate; they are reported separately.
- Never forecast or predict. Describe only what the figures show.
- Never use "only", "sole" or "the single" about a count unless that count is exactly 1 in the input.
- Refer to service levels by their code (23A, 23B NUL, 23B UL, 23C, 23E).
- Write 3 to 4 SHORT paragraphs separated by a blank line. No headings, no bullets, no preamble, no closing line.
- Paragraph 1: the position in latestCompleteMonth — name exactly the service levels in metTarget as meeting target and exactly those in missedTarget as missing it, with their rates. Never move a service level between the two lists.
- Paragraph 2: the record across the window — the service level(s) in missedTargetInMostCompleteMonths, and which meet target over the whole window.
- Paragraph 3: where failures concentrate (the group, dimension and service level).
- Paragraph 4: items still open past their deadline at the extract date.
- British/Irish English. Plain, direct, unhedged. No marketing language.`;

export const awsRegion = () => process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';

/** Shared Bedrock text call, used by the narrative and the Q&A assistant alike. */
export async function bedrockText({ system, user, maxTokens = 1400, temperature = 0.2 }) {
  if (isNova(BEDROCK_MODEL)) {
    const { BedrockRuntimeClient, ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime');
    const client = new BedrockRuntimeClient({ region: awsRegion() });
    const res = await client.send(
      new ConverseCommand({
        modelId: BEDROCK_MODEL,
        system: [{ text: system }],
        messages: [{ role: 'user', content: [{ text: user }] }],
        inferenceConfig: { maxTokens, temperature, topP: 0.9 },
      }),
    );
    return (res.output?.message?.content ?? []).map((b) => b.text ?? '').join('').trim();
  }

  const { AnthropicBedrockMantle } = await import('@anthropic-ai/bedrock-sdk');
  const client = new AnthropicBedrockMantle({ awsRegion: awsRegion() });
  const res = await client.messages.create({
    model: BEDROCK_MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  });
  return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
}

export const activeModel = () => BEDROCK_MODEL;
export const bedrockAvailable = () => hasBedrockCredentials();

/**
 * Reject text that quotes a figure not present in its own input.
 *
 * Every digit-bearing token in the text must appear somewhere in the payload the model was
 * given; anything else means it invented a figure. Word-form numbers are left alone — they
 * restate the input rather than asserting a new quantity.
 */
export function unsupportedFigures(text, payload) {
  const known = new Set();
  for (const m of JSON.stringify(payload).matchAll(/-?\d+(?:\.\d+)?/g)) {
    known.add(m[0]);
    known.add(String(Number(m[0]))); // 30534 and 30534.0 are the same figure
  }

  const bad = [];
  for (const m of text.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)) {
    const raw = m[0].replace(/,/g, '');
    if (known.has(raw) || known.has(String(Number(raw)))) continue;
    bad.push(m[0]);
  }
  return [...new Set(bad)];
}

const SLA_CODE = /23B UL Step [123]|23B NUL|23B UL|23A|23C|23E/g;
const SAYS_MISSED = /\b(fail\w*|miss\w*|fell short|short of|below|breach\w*|did not meet|not met)\b/i;
const SAYS_MET = /\b(met|meet|meets|meeting|pass\w*|achieved|above|on target)\b/i;
const CLAUSE_BREAK = /[.;:]|\bwhile\b|\bwhereas\b|\bbut\b|\balthough\b|\bhowever\b/i;

/**
 * Reject text that gets a service level's pass/fail the wrong way round.
 *
 * The figure guard cannot catch this: "23C failed at 96.97%" quotes a real figure but
 * states the opposite of what it means. The opening paragraph is about the latest complete
 * month, so each of its clauses that names service levels alongside a met-word or a
 * missed-word is checked against their actual result there. A claim about which service
 * level misses target most often must name one of those that actually do. A clause holding
 * both kinds of word is ambiguous and left alone.
 */
export function contradictedClaims(text, intel) {
  const latest = new Map(intel.trends.map((t) => [t.label, t.latest?.status]));
  const headline = intel.trends.filter((t) => !t.parent);
  const mostOften = new Set(failedMostOften(headline).map((f) => f.sla));
  const bad = [];

  const opening = text.split(/\n\s*\n/)[0] ?? '';
  for (const clause of opening.split(CLAUSE_BREAK)) {
    const codes = [...clause.matchAll(SLA_CODE)].map((m) => m[0]);
    const missed = SAYS_MISSED.test(clause);
    const met = SAYS_MET.test(clause);
    if (!codes.length || missed === met) continue;
    for (const c of codes) {
      if (missed && latest.get(c) === 'PASS') bad.push(`${c} said to miss target in ${intel.latestFull.label} but met it`);
      if (met && latest.get(c) === 'FAIL') bad.push(`${c} said to meet target in ${intel.latestFull.label} but missed it`);
    }
  }

  for (const clause of text.split(CLAUSE_BREAK)) {
    if (!/\bmost (often|frequently)\b/i.test(clause)) continue;
    for (const m of clause.matchAll(SLA_CODE)) {
      if (!mostOften.has(m[0])) bad.push(`${m[0]} said to fail most often, but ${[...mostOften].join(', ')} ${mostOften.size === 1 ? 'does' : 'do'}`);
    }
  }
  return [...new Set(bad)];
}

async function bedrockNarrative(intel) {
  const payload = brief(intel);
  const text = await bedrockText({
    system: SYSTEM_PROMPT,
    user: `Write the executive insight summary from these computed figures:\n\n${JSON.stringify(payload, null, 2)}`,
  });
  if (!text) throw new Error('Bedrock returned no text');
  const invented = unsupportedFigures(text, payload);
  if (invented.length) throw new Error(`narrative quoted figures absent from its input: ${invented.join(', ')}`);
  const wrong = contradictedClaims(text, intel);
  if (wrong.length) throw new Error(`narrative contradicted the computed results: ${wrong.join('; ')}`);
  return text;
}

// -------------------------------------------------------------- entrypoint

export async function generateNarrative(intel, { refresh = false } = {}) {
  const configured = hasBedrockCredentials();
  // Enabling Bedrock or changing its model/region must not reuse a rules summary
  // or a response from another configuration. Credential values never enter the cache.
  const key = fingerprint({
    brief: brief(intel),
    provider: configured ? 'bedrock' : 'rules',
    model: configured ? BEDROCK_MODEL : null,
    region: configured ? awsRegion() : null,
  });

  if (!refresh) {
    const cached = readCache(key);
    if (cached) return { ...cached, cached: true };
  }

  if (configured) {
    try {
      const text = await bedrockNarrative(intel);
      return writeCache(key, { text, source: 'bedrock', model: BEDROCK_MODEL, generatedAt: new Date().toISOString() });
    } catch (err) {
      // A credential, quota or network problem must never take the panel down.
      return { text: composeNarrative(intel), source: 'rules', fallbackReason: err.message, generatedAt: new Date().toISOString(), cached: false };
    }
  }

  return writeCache(key, { text: composeNarrative(intel), source: 'rules', generatedAt: new Date().toISOString() });
}

export const narrativeStatus = () => ({
  bedrockConfigured: hasBedrockCredentials(),
  credentialSource: credentialSource(),
  model: BEDROCK_MODEL,
  region: awsRegion(),
});
