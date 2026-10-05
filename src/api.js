import { customerResponse } from './lib/customerCopy.js';

async function req(url, options) {
  const res = await fetch(url, options);
  const body = customerResponse(await res.json().catch(() => ({})));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

const qs = (params) => {
  const p = Object.entries(params).filter(([, v]) => v != null && v !== '');
  return p.length ? `?${p.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}` : '';
};

export const api = {
  bootstrap: () => req('/api/bootstrap'),

  extracts: () => req('/api/extracts'),
  upload(files) {
    const form = new FormData();
    for (const f of files) form.append('files', f, f.name);
    return req('/api/extracts', { method: 'POST', body: form });
  },
  removeExtract: (id) => req(`/api/extracts/${id}`, { method: 'DELETE' }),
  rebuild: () => req('/api/extracts/rebuild', { method: 'POST' }),
  loadBundled: () => req('/api/extracts/bundled', { method: 'POST' }),

  analysis: (month) => req(`/api/analysis/${month}`),
  items: (month, { sla, outcome } = {}) => req(`/api/items/${month}${qs({ sla, outcome })}`),

  intelligence: (scope = 'all') => req(`/api/intelligence${qs({ scope })}`),
  ask: (scope, question) =>
    req('/api/intelligence/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope, question }),
    }),
};
