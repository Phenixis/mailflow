// Minimal client for TypeSafe's Jev "System One" HTTP API. Only yes/no questions (noul) are used:
// each answer is the probability, 0..1, that the statement is true for the given state.
export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';

export class JevError extends Error {
  constructor(message, { status = null, retryable = false } = {}) {
    super(message);
    this.name = 'JevError';
    this.status = status;
    this.retryable = retryable;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// POST one request. `questions` is { id: { type: 'noul', instructions, criteria? } }.
// Resolves to { scores: { id: number|undefined }, usage: { input, output }, model }.
export async function askJev({
  apiKey, model, state, questions,
  endpoint = process.env.TYPESAFE_ENDPOINT || JEV_ENDPOINT,
  fetchImpl = fetch, timeoutMs = 30_000, retries = 3, backoffMs = 1000,
}) {
  if (!apiKey) throw new JevError('No Jev API key configured');
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(backoffMs * 2 ** (attempt - 1));
    try {
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ state, model, questions }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429 || res.status === 529 || res.status >= 500) {
        throw new JevError(`Jev API HTTP ${res.status}`, { status: res.status, retryable: true });
      }
      if (!res.ok) {
        // Never echo the response body: it could carry request content or credentials.
        throw new JevError(`Jev API HTTP ${res.status}`, { status: res.status });
      }
      const json = await res.json();
      const scores = {};
      for (const id of Object.keys(questions)) {
        const value = json?.answers?.[id]?.noul;
        scores[id] = typeof value === 'number' && value >= 0 && value <= 1 ? value : undefined;
      }
      return {
        scores,
        usage: { input: json?.usage?.input_tokens ?? 0, output: json?.usage?.output_tokens ?? 0 },
        model: json?.model ?? model,
      };
    } catch (err) {
      lastError = err instanceof JevError ? err : new JevError(`Jev request failed: ${err.name}`, { retryable: true });
      if (!lastError.retryable) throw lastError;
    }
  }
  throw lastError;
}
