import { describe, it, expect, vi } from 'vitest';
import { askJev, JevError } from './jevClient.js';

vi.mock('../api.js', () => ({ httpRequest: vi.fn() }));

const ok = (body) => ({ status: 200, ok: true, text: JSON.stringify(body) });
const fail = (status) => ({ status, ok: false, text: '{}' });
const base = { apiKey: 'k', model: 'jev-latest', state: { subject: 's' }, questions: { a: { type: 'noul', instructions: 'q' } }, backoffMs: 0 };

describe('askJev', () => {
  it('sends the bearer key to the Jev endpoint and returns scores and usage', async () => {
    const request = vi.fn(async () => ok({ model: 'jev-1.13.0', answers: { a: { noul: 0.7 } }, usage: { input_tokens: 5, output_tokens: 1 } }));
    const out = await askJev({ ...base, request });
    expect(out).toEqual({ scores: { a: 0.7 }, usage: { input: 5, output: 1 }, model: 'jev-1.13.0' });
    const call = request.mock.calls[0][0];
    expect(call.url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(call.headers.Authorization).toBe('Bearer k');
    expect(JSON.parse(call.body)).toMatchObject({ model: 'jev-latest', state: { subject: 's' } });
  });

  it('maps missing or out-of-range answers to undefined, and rejects invalid JSON', async () => {
    expect((await askJev({ ...base, request: async () => ok({ answers: { a: { noul: 1.5 } } }) })).scores).toEqual({ a: undefined });
    await expect(askJev({ ...base, request: async () => ({ status: 200, ok: true, text: 'nope' }) })).rejects.toThrow('invalid JSON');
  });

  it('retries 429/5xx then succeeds', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(fail(429)).mockResolvedValueOnce(fail(529))
      .mockResolvedValueOnce(ok({ answers: { a: { noul: 0.1 } } }));
    expect((await askJev({ ...base, request })).scores.a).toBe(0.1);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('does not retry a 401 and does not leak the body', async () => {
    const request = vi.fn(async () => fail(401));
    await expect(askJev({ ...base, request })).rejects.toMatchObject({ name: 'JevError', status: 401, message: 'Jev API HTTP 401' });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('retries a network failure, but not a request core refused', async () => {
    const flaky = vi.fn().mockRejectedValueOnce(new TypeError('socket hang up')).mockResolvedValueOnce(ok({ answers: { a: { noul: 0.2 } } }));
    expect((await askJev({ ...base, request: flaky })).scores.a).toBe(0.2);
    const refused = vi.fn().mockRejectedValue(Object.assign(new Error('Host "x" is not declared'), { name: 'PluginNetworkError' }));
    await expect(askJev({ ...base, request: refused })).rejects.toThrow('not declared');
    expect(refused).toHaveBeenCalledTimes(1);
  });

  it('gives up after the retries and requires a key', async () => {
    const request = vi.fn(async () => fail(500));
    await expect(askJev({ ...base, request, retries: 2 })).rejects.toBeInstanceOf(JevError);
    expect(request).toHaveBeenCalledTimes(3);
    await expect(askJev({ ...base, apiKey: '' })).rejects.toThrow('No Jev API key');
  });
});
