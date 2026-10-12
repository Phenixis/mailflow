// Minimal client for TypeSafe's Jev "System One" HTTP API. Only yes/no questions (noul) are used:
// each answer is the probability, 0..1, that the statement is true for the given state. The request
// goes through core's httpRequest (restricted to the host this plugin declares), never the network.
import { httpRequest } from '../api.js';
import { PLUGIN_ID, JEV_ENDPOINT } from './defaults.js';

export class JevError extends Error {
  constructor(message, { status = null, retryable = false } = {}) {
    super(message);
    this.name = 'JevError';
    this.status = status;
    this.retryable = retryable;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// POST one request. `questions` is { key: { type: 'noul', instructions, criteria? } }.
// Resolves to { scores: { key: number|undefined }, usage: { input, output }, model }.
export async function askJev({
  apiKey, model, state, questions,
  request = (req) => httpRequest(PLUGIN_ID, req),
  endpoint = JEV_ENDPOINT, timeoutMs = 30_000, retries = 3, backoffMs = 1000,
}) {
  if (!apiKey) throw new JevError('No Jev API key configured');
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(backoffMs * 2 ** (attempt - 1));
    try {
      const res = await request({
        url: endpoint, method: 'POST', timeoutMs,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ state, model, questions }),
      });
      if (res.status === 429 || res.status === 529 || res.status >= 500) {
        throw new JevError(`Jev API HTTP ${res.status}`, { status: res.status, retryable: true });
      }
      // Never echo the response body: it could carry request content or credentials.
      if (!res.ok) throw new JevError(`Jev API HTTP ${res.status}`, { status: res.status });
      let json;
      try { json = JSON.parse(res.text); } catch { throw new JevError('Jev API returned invalid JSON'); }
      const scores = {};
      for (const key of Object.keys(questions)) {
        const value = json?.answers?.[key]?.noul;
        scores[key] = typeof value === 'number' && value >= 0 && value <= 1 ? value : undefined;
      }
      return {
        scores,
        usage: { input: json?.usage?.input_tokens ?? 0, output: json?.usage?.output_tokens ?? 0 },
        model: json?.model ?? model,
      };
    } catch (err) {
      if (err instanceof JevError) lastError = err;
      else if (err?.name === 'PluginNetworkError') lastError = new JevError(err.message); // a refused request will not succeed on retry
      else lastError = new JevError(`Jev request failed: ${err?.name || 'Error'}`, { retryable: true });
      if (!lastError.retryable) throw lastError;
    }
  }
  throw lastError;
}
