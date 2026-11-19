import { describe, it, expect, vi, beforeEach } from 'vitest';

const api = vi.hoisted(() => ({
  loadOwnedMessage: vi.fn(), applyTag: vi.fn(), removeTag: vi.fn(), setMessageAnnotation: vi.fn(), ensureMessageBody: vi.fn(),
  logger: { warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../api.js', () => api);
const cfg = vi.hoisted(() => ({ loadSettings: vi.fn(), activeEntries: vi.fn() }));
vi.mock('./config.js', () => cfg);
const examples = vi.hoisted(() => ({ withLearnedExamples: vi.fn(async (_u, entries) => entries) }));
vi.mock('./examples.js', () => examples);

import { classifyMessage } from './service.js';
import { JevError } from './jevClient.js';
import { DEFAULT_TAGS, DEFAULT_SETTINGS } from './defaults.js';

const entries = DEFAULT_TAGS.map((t) => ({ key: t.key, name: t.name, question: t.question }));
const message = { id: 'm1', account_id: 'a1', from_name: 'A', from_email: 'a@x.example', subject: 'Hi', snippet: '', body_text: '' };
const scoresAsk = (scores) => vi.fn(async (req) => ({
  scores: Object.fromEntries(Object.keys(req.questions).map((k) => [k, scores[k] ?? 0.1])), usage: { input: 7, output: 1 }, model: 'm',
}));

beforeEach(() => {
  vi.clearAllMocks();
  api.loadOwnedMessage.mockResolvedValue(message);
  cfg.loadSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, apiKey: 'k' });
  cfg.activeEntries.mockResolvedValue(entries);
});

describe('classifyMessage - body not stored yet (Gmail)', () => {
  it('fetches the body through core when a second look needs it, and uses it for pass 2', async () => {
    const stored = { ...message, body_text: null, snippet: '' };
    api.loadOwnedMessage.mockResolvedValueOnce(stored).mockResolvedValue({ ...message, body_text: 'Campus closed tomorrow.' });
    api.ensureMessageBody.mockResolvedValue('fetched');
    const askImpl = vi.fn(async (req) => ({
      scores: Object.fromEntries(Object.keys(req.questions).map((k) => [k, k === 'private' ? 0.1 : (req.state.body_excerpt ? 0.9 : 0.5)])), usage: { input: 1, output: 1 }, model: 'm',
    }));
    cfg.activeEntries.mockResolvedValue(entries);
    const out = await classifyMessage('u1', 'm1', { askImpl, today: '2026-10-13' });
    expect(api.ensureMessageBody).toHaveBeenCalledWith('u1', 'm1');
    expect(askImpl).toHaveBeenCalledTimes(2);
    expect(askImpl.mock.calls[1][0].state.body_excerpt).toBe('Campus closed tomorrow.');
    expect(out.outcome.bodyMissing).toBe(false);
    expect(api.setMessageAnnotation.mock.calls[0][3].run).toMatchObject({ bodySent: true, bodyMissing: false });
  });

  it('records that the body was missing when it cannot be fetched', async () => {
    api.loadOwnedMessage.mockResolvedValue({ ...message, body_text: null, snippet: '' });
    api.ensureMessageBody.mockResolvedValue('failed');
    const askImpl = vi.fn(async (req) => ({ scores: Object.fromEntries(Object.keys(req.questions).map((k) => [k, k === 'private' ? 0.1 : 0.5])), usage: { input: 1, output: 1 }, model: 'm' }));
    await classifyMessage('u1', 'm1', { askImpl });
    expect(askImpl).toHaveBeenCalledTimes(1);
    expect(api.setMessageAnnotation.mock.calls[0][3].run).toMatchObject({ bodySent: false, bodyMissing: true });
  });
});

describe('classifyMessage', () => {
  it('asks Jev with the examples learned from the user\'s own tagging', async () => {
    examples.withLearnedExamples.mockImplementationOnce(async (_u, list) => list.map((e) => (
      e.key === 'urgent' ? { ...e, question: { ...e.question, true_examples: ['Flight tomorrow — Airline'] } } : e)));
    const askImpl = scoresAsk({});
    await classifyMessage('u1', 'm1', { askImpl, today: '2026-10-12' });
    expect(examples.withLearnedExamples).toHaveBeenCalledWith('u1', entries);
    expect(askImpl.mock.calls[0][0].questions.urgent.criteria.true.examples).toEqual(['Flight tomorrow — Airline']);
  });

  it('applies the tags Jev says yes to, takes back the others, and keeps the answers on the message', async () => {
    const askImpl = scoresAsk({ important: 0.9 });
    const out = await classifyMessage('u1', 'm1', { askImpl, today: '2026-10-12' });
    expect(out.status).toBe('done');
    expect(askImpl.mock.calls[0][0]).toMatchObject({ apiKey: 'k', model: 'jev-latest' });
    expect(api.applyTag).toHaveBeenCalledTimes(1);
    expect(api.applyTag).toHaveBeenCalledWith('jev-tags', 'u1', 'm1', 'important');
    expect(api.removeTag.mock.calls.map((c) => c[3]).sort()).toEqual(['private', 'urgent']);
    const [accountId, messageId, pluginId, patch] = api.setMessageAnnotation.mock.calls[0];
    expect([accountId, messageId, pluginId]).toEqual(['a1', 'm1', 'jev-tags']);
    expect(patch.answers.important).toEqual({ score: 0.9, applied: true, pass: 1, bodySent: false });
    expect(patch.answers.urgent.applied).toBe(false);
    expect(patch.run).toMatchObject({ status: 'done', pass: 1, bodySent: false, isPrivate: false, input: 7 });
  });

  it('does nothing without a key, without questions, or for a message the user does not own', async () => {
    const askImpl = vi.fn();
    cfg.loadSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, apiKey: null });
    expect((await classifyMessage('u1', 'm1', { askImpl })).status).toBe('no-key');
    cfg.loadSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, apiKey: 'k' });
    cfg.activeEntries.mockResolvedValue([]);
    expect((await classifyMessage('u1', 'm1', { askImpl })).status).toBe('no-tags');
    api.loadOwnedMessage.mockResolvedValue(null);
    expect((await classifyMessage('u1', 'm1', { askImpl })).status).toBe('missing');
    expect(askImpl).not.toHaveBeenCalled();
    expect(api.applyTag).not.toHaveBeenCalled();
  });

  it('records a Jev failure as an error run and leaves the tags alone', async () => {
    const askImpl = vi.fn().mockRejectedValue(new JevError('Jev API HTTP 401', { status: 401 }));
    expect(await classifyMessage('u1', 'm1', { askImpl })).toEqual({ status: 'error', error: 'Jev API HTTP 401' });
    expect(api.applyTag).not.toHaveBeenCalled();
    expect(api.removeTag).not.toHaveBeenCalled();
    expect(api.setMessageAnnotation.mock.calls[0][3]).toMatchObject({ run: { status: 'error', error: 'Jev API HTTP 401' } });
  });

  it('reduces an unexpected error to its name', async () => {
    const askImpl = vi.fn().mockRejectedValue(new TypeError('secret subject text'));
    expect((await classifyMessage('u1', 'm1', { askImpl })).error).toBe('Unexpected error: TypeError');
  });
});
