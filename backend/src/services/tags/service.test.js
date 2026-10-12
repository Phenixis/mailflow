import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => ({
  listDefinitions: vi.fn(), loadSettings: vi.fn(), loadOwnedMessageForTags: vi.fn(), saveClassification: vi.fn(), saveRun: vi.fn(),
}));
vi.mock('./store.js', () => store);
const broadcast = vi.hoisted(() => vi.fn());
vi.mock('../../plugins/mailEngine.js', () => ({ getMailEngine: () => ({ broadcast }) }));
vi.mock('../logger.js', () => ({ logger: { warn: vi.fn(), debug: vi.fn() } }));

import { classifyMessage } from './service.js';
import { JevError } from './jevClient.js';
import { DEFAULT_TAGS, DEFAULT_SETTINGS } from './defaults.js';

const defs = DEFAULT_TAGS.map((t, i) => ({ ...t, id: `t-${t.key}`, enabled: true, position: i }));
const message = { id: 'm1', from_name: 'A', from_email: 'a@x.example', subject: 'Hi', snippet: '', body_text: '' };

beforeEach(() => {
  vi.clearAllMocks();
  store.listDefinitions.mockResolvedValue(defs);
  store.loadSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, apiKey: 'k' });
  store.loadOwnedMessageForTags.mockResolvedValue(message);
});

describe('classifyMessage', () => {
  it('stores the outcome and tells the user\'s tabs', async () => {
    const askImpl = vi.fn(async (req) => ({
      scores: Object.fromEntries(Object.keys(req.questions).map((id) => [id, 0.1])), usage: { input: 1, output: 1 }, model: 'm',
    }));
    const out = await classifyMessage('u1', 'm1', { askImpl, today: '2026-10-12' });
    expect(out.status).toBe('done');
    expect(askImpl.mock.calls[0][0]).toMatchObject({ apiKey: 'k', model: 'jev-latest' });
    expect(store.saveClassification).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith({ type: 'tags_updated', messageIds: ['m1'] }, 'u1');
  });

  it('does nothing without a key or for a message the user does not own', async () => {
    const askImpl = vi.fn();
    store.loadSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, apiKey: null });
    expect((await classifyMessage('u1', 'm1', { askImpl })).status).toBe('no-key');
    store.loadOwnedMessageForTags.mockResolvedValue(null);
    expect((await classifyMessage('u1', 'm1', { askImpl })).status).toBe('missing');
    expect(askImpl).not.toHaveBeenCalled();
  });

  it('records a Jev failure as an error run without leaking anything else', async () => {
    const askImpl = vi.fn().mockRejectedValue(new JevError('Jev API HTTP 401', { status: 401 }));
    const out = await classifyMessage('u1', 'm1', { askImpl });
    expect(out).toEqual({ status: 'error', error: 'Jev API HTTP 401' });
    expect(store.saveRun).toHaveBeenCalledWith('m1', expect.objectContaining({ status: 'error', error: 'Jev API HTTP 401' }));
    expect(store.saveClassification).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('reduces an unexpected error to its name', async () => {
    const askImpl = vi.fn().mockRejectedValue(new TypeError('secret subject text'));
    const out = await classifyMessage('u1', 'm1', { askImpl });
    expect(out.error).toBe('Unexpected error: TypeError');
  });
});
