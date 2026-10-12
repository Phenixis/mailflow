import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';

const api = vi.hoisted(() => ({
  requireAuth: (req, _res, next) => { req.session = { userId: 'u1' }; next(); },
  listUserAccounts: vi.fn(), getAccountConfig: vi.fn(), setAccountConfig: vi.fn(), loadOwnedMessage: vi.fn(),
  getMessageAnnotations: vi.fn(), listTagDefinitions: vi.fn(), listInboxMessageIds: vi.fn(), logger: { warn: vi.fn() },
}));
vi.mock('../api.js', () => api);
const cfg = vi.hoisted(() => ({
  loadSettings: vi.fn(), saveSettings: vi.fn(), loadQuestions: vi.fn(), saveQuestion: vi.fn(), removeQuestion: vi.fn(), ensureDefaults: vi.fn(),
}));
vi.mock('./config.js', () => cfg);
const enqueue = vi.hoisted(() => vi.fn(() => 1));
vi.mock('./queue.js', () => ({ jevQueue: { enqueue } }));

import 'express-async-errors';
import express from 'express';
import routes from './routes.js';

const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
let server, base;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/jev-tags', routes);
  app.use((err, _req, res, next) => { void next; res.status(500).json({ error: String(err.message) }); });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/jev-tags`;
});
afterAll(() => new Promise((r) => server.close(r)));
beforeEach(() => {
  vi.clearAllMocks();
  cfg.loadSettings.mockResolvedValue({ apiKey: 'secret', apiKeySource: 'ui', threshold_low: 0.35, threshold_high: 0.65, private_above: 0.4, max_body_chars: 500, model: 'jev-latest', privacyTagKey: 'private' });
});
const call = (method, path, body) => fetch(base + path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });

describe('settings', () => {
  it('never returns the API key', async () => {
    const json = await (await call('GET', '/settings')).json();
    expect(json.hasApiKey).toBe(true);
    expect(JSON.stringify(json)).not.toContain('secret');
  });

  it('rejects an inverted band and out-of-range values, and saves valid ones', async () => {
    expect((await call('PUT', '/settings', { threshold_low: 0.7 })).status).toBe(400); // 0.7 >= current high 0.65
    expect((await call('PUT', '/settings', { private_above: 1.5 })).status).toBe(400);
    expect((await call('PUT', '/settings', { max_body_chars: 99999 })).status).toBe(400);
    expect((await call('PUT', '/settings', { model: 'bad model!' })).status).toBe(400);
    expect((await call('PUT', '/settings', { privacyTagKey: 'Not A Key' })).status).toBe(400);
    expect(cfg.saveSettings).not.toHaveBeenCalled();
    expect((await call('PUT', '/settings', { apiKey: 'new', private_above: 0.5 })).status).toBe(200);
    expect(cfg.saveSettings).toHaveBeenCalledWith('u1', { apiKey: 'new', private_above: 0.5 });
  });
});

describe('questions', () => {
  it('lists every tag with its question or null', async () => {
    api.listTagDefinitions.mockResolvedValue([{ key: 'urgent', name: 'Urgent', color: '#ef4444', enabled: true }, { key: 'travel', name: 'Travel', color: '#000000', enabled: true }]);
    cfg.loadQuestions.mockResolvedValue({ urgent: { instructions: 'q', enabled: true } });
    const json = await (await call('GET', '/questions')).json();
    expect(json.map((t) => [t.key, t.question === null])).toEqual([['urgent', false], ['travel', true]]);
  });

  it('validates a question, requires an existing tag, and saves it with defaults filled in', async () => {
    api.listTagDefinitions.mockResolvedValue([{ key: 'travel', name: 'Travel', enabled: true }]);
    expect((await call('PUT', '/questions/travel', {})).status).toBe(400);
    expect((await call('PUT', '/questions/travel', { instructions: 'q', true_examples: 'nope' })).status).toBe(400);
    expect((await call('PUT', '/questions/travel', { instructions: 'q', threshold_high: 2 })).status).toBe(400);
    expect((await call('PUT', '/questions/Bad Key', { instructions: 'q' })).status).toBe(400);
    expect((await call('PUT', '/questions/ghost', { instructions: 'q' })).status).toBe(404);
    expect(cfg.saveQuestion).not.toHaveBeenCalled();
    expect((await call('PUT', '/questions/travel', { instructions: ' About a trip? ', true_examples: ['Your flight'] })).status).toBe(200);
    expect(cfg.saveQuestion).toHaveBeenCalledWith('u1', 'travel', {
      instructions: 'About a trip?', true_what: null, true_examples: ['Your flight'], false_what: null, false_examples: [],
      threshold_low: null, threshold_high: null, enabled: true,
    });
  });

  it('removes a question and creates the defaults', async () => {
    expect((await call('DELETE', '/questions/travel')).status).toBe(200);
    expect(cfg.removeQuestion).toHaveBeenCalledWith('u1', 'travel');
    expect((await call('POST', '/defaults')).status).toBe(200);
    expect(cfg.ensureDefaults).toHaveBeenCalledWith('u1');
  });
});

describe('accounts opt-in', () => {
  it('lists accounts default-off and only toggles accounts the user owns', async () => {
    api.listUserAccounts.mockResolvedValue([{ id: ID, email_address: 'a@x.example' }]);
    api.getAccountConfig.mockResolvedValue({});
    expect(await (await call('GET', '/accounts')).json()).toEqual([{ id: ID, email: 'a@x.example', enabled: false }]);
    expect((await call('PUT', `/accounts/${ID2}`, { enabled: true })).status).toBe(404);
    expect((await call('PUT', `/accounts/${ID}`, { enabled: 'yes' })).status).toBe(400);
    expect((await call('PUT', `/accounts/${ID}`, { enabled: true })).status).toBe(200);
    expect(api.setAccountConfig).toHaveBeenCalledWith('jev-tags', ID, { enabled: true });
  });
});

describe('messages', () => {
  it('explains a message: Jev\'s answers with tag names, plus the run; 404 for another user\'s message', async () => {
    api.loadOwnedMessage.mockResolvedValue(null);
    expect((await call('GET', `/messages/${ID}`)).status).toBe(404);
    api.loadOwnedMessage.mockResolvedValue({ id: ID, account_id: ID2 });
    api.listTagDefinitions.mockResolvedValue([{ key: 'urgent', name: 'Urgent', color: '#ef4444' }, { key: 'travel', name: 'Travel', color: '#000000' }]);
    api.getMessageAnnotations.mockResolvedValue({ [ID]: { run: { status: 'done' }, answers: { urgent: { score: 0.9, applied: true, pass: 1, bodySent: false }, deleted_tag: { score: 0.1 } } } });
    const json = await (await call('GET', `/messages/${ID}`)).json();
    expect(json.answers).toEqual([{ key: 'urgent', name: 'Urgent', color: '#ef4444', score: 0.9, applied: true, pass: 1, bodySent: false }]);
    expect(json.run.status).toBe('done');
    expect(api.getMessageAnnotations).toHaveBeenCalledWith(ID2, [ID], 'jev-tags');
  });

  it('reclassifies only with a key and ownership', async () => {
    api.loadOwnedMessage.mockResolvedValue({ id: ID });
    expect((await call('POST', `/messages/${ID}/classify`)).status).toBe(202);
    expect(enqueue).toHaveBeenCalledWith('u1', [ID]);
    enqueue.mockClear();
    cfg.loadSettings.mockResolvedValue({ apiKey: null });
    expect((await call('POST', `/messages/${ID}/classify`)).status).toBe(400);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('backfills only opted-in accounts, and only unannotated mail unless forced', async () => {
    api.listUserAccounts.mockResolvedValue([{ id: ID }, { id: ID2 }]);
    api.getAccountConfig.mockImplementation(async (_p, id) => ({ enabled: id === ID }));
    api.listInboxMessageIds.mockResolvedValue(['m1', 'm2']);
    expect((await call('POST', '/backfill', { limit: 50 })).status).toBe(202);
    expect(api.listInboxMessageIds).toHaveBeenLastCalledWith('u1', [ID], 50, { withoutAnnotation: 'jev-tags' });
    expect((await call('POST', '/backfill', { limit: 9999 })).status).toBe(400);
    expect((await call('POST', '/backfill', { limit: 10, force: 'yes' })).status).toBe(400);
    await call('POST', '/backfill', { limit: 10, force: true });
    expect(api.listInboxMessageIds).toHaveBeenLastCalledWith('u1', [ID], 10, { withoutAnnotation: null });
  });
});
