/** Customer terminology for descriptive text, including previously saved findings. */
export function customerText(value) {
  if (typeof value !== 'string') return value;
  const matchCase = (word, replacement) => word === word.toUpperCase()
    ? replacement.toUpperCase()
    : /^[A-Z]/.test(word) ? replacement[0].toUpperCase() + replacement.slice(1) : replacement;
  return value
    .replace(/\b(?:TCS\s+)?BaNCS(?:\s+Insurance)?\s*(?:[·:—–-]\s*)?/gi, '')
    .replace(/\bSLA position\b/gi, 'SLA Status')
    .replace(/\ban (?=extract\b)/gi, (word) => matchCase(word, 'a '))
    .replace(/\bextracts?\b/gi, (word) => matchCase(word, /s$/i.test(word) ? 'data sources' : 'data source'))
    .replace(/\ban item\b/gi, (word) => matchCase(word, 'a policy'))
    .replace(/\bitems?\b/gi, (word) => matchCase(word, /s$/i.test(word) ? 'policies' : 'policy'));
}

// Only presentation fields are adapted. IDs, filenames, source records, outcomes,
// API keys and numeric evidence keep their original values for traceability.
const TEXT_FIELDS = new Set([
  'label', 'title', 'detail', 'statement', 'monthBasis', 'as_of_source',
  'text', 'answer', 'error', 'matchedSla',
]);

export function customerResponse(value, field = '') {
  if (typeof value === 'string') {
    return TEXT_FIELDS.has(field) || field === 'suggestedQuestions' ? customerText(value) : value;
  }
  if (Array.isArray(value)) return value.map((entry) => customerResponse(entry, field));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, customerResponse(entry, key)]));
  }
  return value;
}

export const POLICY_COUNT_NOTE = 'Policies are counted per service record; the same policy can appear more than once.';
