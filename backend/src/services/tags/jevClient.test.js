import { describe, it, expect, vi } from 'vitest';
import { askJev, JevError } from './jevClient.js';

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const fail = (status) => ({ ok: false, status, json: async () => ({}) });
const base = { apiKey: 'k', model: 'jev-latest', state: { subject: 's' }, questions: { a: { type: 'noul', instructions: 'q' } }, backoffMs: 0 };

describe('askJev', () => {
  it('sends the bearer key and returns scores and usage', async () => {
    const fetchImpl = vi.fn(async () => ok({ model: 'jev-1.13.0', answers: { a: { noul: 0.7 } }, usage: { input_tokens: 5, output_tokens: 1 } }));
    const out = await askJev({ ...base, fetchImpl });
    expect(out).toEqual({ scores: { a: 0.7 }, usage: { input: 5, output: 1 }, model: 'jev-1.13.0' });
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer k');
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({ model: 'jev-latest', state: { subject: 's' } });
  });

  it('maps missing or out-of-range answers to undefined', async () => {
    const fetchImpl = async () => ok({ answers: { a: { noul: 1.5 } } });
    expect((await askJev({ ...base, fetchImpl })).scores).toEqual({ a: undefined });
  });

  it('retries 429/5xx then succeeds', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(fail(429)).mockResolvedValueOnce(fail(529))
      .mockResolvedValueOnce(ok({ answers: { a: { noul: 0.1 } } }));
    expect((await askJev({ ...base, fetchImpl })).scores.a).toBe(0.1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('does not retry a 401 and does not leak the body', async () => {
    const fetchImpl = vi.fn(async () => fail(401));
    await expect(askJev({ ...base, fetchImpl })).rejects.toMatchObject({ name: 'JevError', status: 401, message: 'Jev API HTTP 401' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('gives up after the retries and requires a key', async () => {
    const fetchImpl = vi.fn(async () => fail(500));
    await expect(askJev({ ...base, fetchImpl, retries: 2 })).rejects.toBeInstanceOf(JevError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    await expect(askJev({ ...base, apiKey: '' })).rejects.toThrow('No Jev API key');
  });
});
