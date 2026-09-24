import { useState } from 'react';
import { api } from '../api.js';

/**
 * "Ask about this report" — a Q&A layer over the computed intelligence outputs.
 *
 * Deliberately not a chat window: single question, single answer, no history. It answers
 * from the figures the engine already calculated, and says so when a question falls outside
 * the report. Scoping it this tightly is what makes it trustworthy in a governance setting.
 */
export default function AskReport({ scope, suggestions = [] }) {
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState(null);
  const [asking, setAsking] = useState(false);

  async function ask(text) {
    const q = String(text ?? question).trim();
    if (!q || asking) return;
    setAsking(true);
    setQuestion(q);
    try {
      const res = await api.ask(scope, q);
      setResult({ ...res, question: q });
    } catch (err) {
      setResult({ question: q, answer: err.message, source: 'error' });
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="ask-box">
      <div className="ask-head">Ask about this report</div>

      <form className="ask-form" onSubmit={(e) => { e.preventDefault(); ask(); }}>
        <input
          className="ask-input"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. why did 23E miss target?"
          maxLength={400}
          aria-label="Ask a question about this report"
        />
        <button type="submit" className="ask-send" disabled={asking || !question.trim()}>
          {asking ? 'Asking…' : 'Ask'}
        </button>
      </form>

      {!result && suggestions.length > 0 && (
        <div className="ask-chips">
          {suggestions.map((s) => (
            <button key={s} type="button" className="ask-chip" onClick={() => ask(s)}>{s}</button>
          ))}
        </div>
      )}

      {result && (
        <div className="ask-answer">
          <div className="ask-question">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" /><path d="M9.2 9.3a2.9 2.9 0 1 1 3.6 3.3v1.3M12 17.3h.01" />
            </svg>
            {result.question}
          </div>
          <div className="ask-text">{result.answer}</div>

          <div className="ask-foot">
            {result.source === 'bedrock' && <span className="ask-tag">Answered by {result.model}</span>}
            {result.source === 'rules' && <span className="ask-tag">Answered from the computed figures</span>}
            {result.source === 'error' && <span className="ask-tag">Could not answer</span>}
            {result.matchedSla && <span className="ask-tag">{result.matchedSla}</span>}
            <span>Grounded in this report only — no outside data.</span>
            <button type="button" className="ask-chip" style={{ marginLeft: 'auto' }}
                    onClick={() => { setResult(null); setQuestion(''); }}>
              Ask another
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
