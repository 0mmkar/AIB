import AskReport from './AskReport.jsx';
import { IconSpark, IconAlert, IconCircleCheck } from './Icons.jsx';

/**
 * The executive summary.
 *
 * Three things carry the "grasp it in ten seconds" claim, and none of them is decoration:
 *
 *  VERDICT     one computed line at the top, derived from the data rather than parsed out
 *              of the prose, so it is exact regardless of how the model phrased things.
 *  FIGURES     numbers inside the prose are visually lifted, because the figures are what
 *              a governance reader scans for.
 *  STRUCTURE   the narrative is written to a fixed running order, so each paragraph gets
 *              its own marker and heading — turning a block of text into four findings.
 */

/**
 * Label a paragraph by what it actually says, not by its position.
 *
 * The narrative is written to a running order, but the model sometimes merges two sections
 * into one paragraph — and a positional label then names the wrong thing, which is worse
 * than no label at all. Unrecognised paragraphs simply go unlabelled.
 */
const TOPICS = [
  { label: 'Overdue backlog', test: /\bopen past|past (?:their|its) deadline|overdue|backlog/i },
  { label: 'Where it is concentrated', test: /\bconcentrat|\buser\b|assigned|handler|transaction type|workflow type/i },
  { label: 'Across the window', test: /\bacross|window|most often|most complete months/i },
  { label: 'Latest month', test: /\bmet (?:their |its )?target|missed (?:their |its )?target|fell short|latest complete month/i },
];

const labelFor = (paragraph) => TOPICS.find((t) => t.test.test(paragraph))?.label ?? null;

/**
 * Lift figures out of the prose without touching the words around them.
 *
 * Not figures: years ("September 2026" is a date), the digits inside a service-level code
 * ("23C", "23B NUL") and step numbers ("Step 2") — boxing those makes the sentence read like
 * a spreadsheet and suggests measurements that are really names.
 */
// The word-boundary anchors sit only on the alphabetic units. A trailing \b after "%" can
// never match — "%" and the following space are both non-word characters — which silently
// backtracks the unit off the match and leaves "5.9 %" split across the highlight.
const FIGURE_RE = /(?<![A-Za-z0-9.])\d+(?:,\d{3})*(?:\.\d+)?(?:\s?%|\s?days?\b|\s?polic(?:y|ies)\b)?(?![A-Za-z0-9])/g;
const isYear = (token) => /^(?:19|20)\d{2}$/.test(token.trim());
// "24 September 2026" — the day is part of a date, not a figure.
const DAY_OF_MONTH = /^\s(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;

function highlightFigures(text) {
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(FIGURE_RE)) {
    const token = m[0];
    if (isYear(token)) continue;
    if (/Step\s$/i.test(text.slice(Math.max(0, m.index - 5), m.index))) continue;
    if (DAY_OF_MONTH.test(text.slice(m.index + token.length, m.index + token.length + 12))) continue;
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(<b key={`${m.index}-${token}`} className="fig">{token}</b>);
    last = m.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** The headline finding, computed from the data — never parsed out of the narrative. */
function verdictOf(data) {
  const month = data.latestFull.label;
  const failing = data.trends.filter((t) => !t.parent && t.latest?.status === 'FAIL');
  if (failing.length) {
    return {
      tone: 'severe',
      headline: `${failing.length} of ${data.headline.slaCount} service levels missed target in ${month}`,
      detail: failing.map((t) => `${t.label} ${(t.latest.rateCompleted * 100).toFixed(2)}% vs ${Math.round(t.target * 100)}%`).join(' · '),
    };
  }
  return {
    tone: 'clear',
    headline: `Every service level with completed policies met target in ${month}`,
    detail: `${data.headline.openPastDeadline.toLocaleString('en-IE')} policies open past deadline at the data source date.`,
  };
}

export default function NarrativeCard({ data, scope }) {
  const narrative = data.narrative;
  if (!narrative) return null;

  const paragraphs = narrative.text
    .split('\n\n')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((text, i) => ({ text, label: labelFor(text), key: i }));

  // Only run the labelled layout when most paragraphs resolved to a topic — a half-labelled
  // list looks like a rendering fault rather than a design.
  const labelled = paragraphs.filter((p) => p.label).length >= Math.ceil(paragraphs.length / 2);
  const verdict = verdictOf(data);

  return (
    <section className="narrative-card">
      <div className="narrative-glow" aria-hidden="true" />

      <header className="narrative-top">
        <div className="row" style={{ gap: 10 }}>
          <span className="narrative-mark"><IconSpark size={15} /></span>
          <div>
            <h2>Executive insight</h2>
            <div className="narrative-scope">
              {scope === 'all' ? `All history · ${data.headline.monthsAnalysed} periods` : `Up to ${data.focusLabel}`}
            </div>
          </div>
        </div>
        <span className="narrative-source">
          {narrative.source === 'bedrock'
            ? narrative.model
            : narrative.fallbackReason ? 'Computed figures · model text rejected' : 'Computed figures'}
          {narrative.cached ? ' · cached' : ''}
        </span>
      </header>

      <div className={`verdict tone-${verdict.tone}`}>
        <span className="verdict-icon">
          {verdict.tone === 'clear' ? <IconCircleCheck size={19} /> : <IconAlert size={19} />}
        </span>
        <div>
          <div className="verdict-headline">{verdict.headline}</div>
          <div className="verdict-detail">{verdict.detail}</div>
        </div>
      </div>

      <div className={`narrative-body${labelled ? ' is-labelled' : ''}`}>
        {paragraphs.map((p, i) => (
          <div className="narrative-para" key={p.key}>
            {labelled && p.label && (
              <div className="para-marker">
                <span className="para-num">{i + 1}</span>
                <span className="para-label">{p.label}</span>
              </div>
            )}
            <p>{highlightFigures(p.text)}</p>
          </div>
        ))}
      </div>

      <AskReport key={scope} scope={scope} suggestions={data.suggestedQuestions ?? []} />
    </section>
  );
}
