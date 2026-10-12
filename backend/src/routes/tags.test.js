import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';

vi.mock('../middleware/auth.js', () => ({ requireAuth: (req, _res, next) => { req.session = { userId: 'u1' }; next(); } }));
vi.mock('../services/mailAccess.js', () => ({ listUserAccounts: vi.fn() }));
vi.mock('../plugins/accountConfig.js', () => ({ getAccountConfig: vi.fn(), setAccountConfig: vi.fn() }));
vi.mock('../services/tags/store.js', () => ({
  listDefinitions: vi.fn(), createDefinition: vi.fn(), updateDefinition: vi.fn(), deleteDefinition: vi.fn(),
  loadSettings: vi.fn(), saveSettings: vi.fn(), loadOwnedMessageForTags: vi.fn(), tagsForMessages: vi.fn(),
  runForMessage: vi.fn(), setManualTag: vi.fn(), inboxMessageIdsToClassify: vi.fn(),
}));
const enqueue = vi.hoisted(() => vi.fn(() => 1));
vi.mock('../services/tags/queue.js', () => ({ tagQueue: { enqueue } }));

import 'express-async-errors';
import express from 'express';
import * as store from '../services/tags/store.js';
import { listUserAccounts } from '../services/mailAccess.js';
import { getAccountConfig, setAccountConfig } from '../plugins/accountConfig.js';
import routes from './tags.js';

const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
let server, base;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/tags', routes);
  app.use((err, _req, res, next) => { void next; res.status(500).json({ error: String(err.message) }); });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/tags`;
});
afterAll(() => new Promise((r) => server.close(r)));
beforeEach(() => {
  vi.clearAllMocks();
  store.loadSettings.mockResolvedValue({ apiKey: 'secret', apiKeySource: 'ui', threshold_low: 0.35, threshold_high: 0.65, private_above: 0.4, max_body_chars: 500, model: 'jev-latest' });
});
const call = (method, path, body) => fetch(base + path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });

describe('settings', () => {
  it('never returns the API key', async () => {
    const res = await call('GET', '/settings');
    const json = await res.json();
    expect(json.hasApiKey).toBe(true);
    expect(JSON.stringify(json)).not.toContain('secret');
  });

  it('rejects an inverted band and out-of-range values, and saves valid ones', async () => {
    expect((await call('PUT', '/settings', { threshold_low: 0.7 })).status).toBe(400); // 0.7 >= current high 0.65
    expect((await call('PUT', '/settings', { private_above: 1.5 })).status).toBe(400);
    expect((await call('PUT', '/settings', { max_body_chars: 99999 })).status).toBe(400);
    expect((await call('PUT', '/settings', { model: 'bad model!' })).status).toBe(400);
    expect(store.saveSettings).not.toHaveBeenCalled();
    expect((await call('PUT', '/settings', { apiKey: 'new', private_above: 0.5 })).status).toBe(200);
    expect(store.saveSettings).toHaveBeenCalledWith('u1', { apiKey: 'new', private_above: 0.5 });
  });
});

describe('definitions', () => {
  it('validates a new tag and refuses a duplicate key', async () => {
    store.listDefinitions.mockResolvedValue([{ key: 'urgent' }]);
    expect((await call('POST', '/definitions', { name: 'X' })).status).toBe(400);
    expect((await call('POST', '/definitions', { key: 'Bad Key', name: 'X', instructions: 'q' })).status).toBe(400);
    expect((await call('POST', '/definitions', { key: 'x', name: 'X', instructions: 'q', color: 'red' })).status).toBe(400);
    expect((await call('POST', '/definitions', { key: 'x', name: 'X', instructions: 'q', true_examples: 'nope' })).status).toBe(400);
    expect((await call('POST', '/definitions', { key: 'urgent', name: 'X', instructions: 'q' })).status).toBe(409);
    store.createDefinition.mockResolvedValue({ id: ID, key: 'travel', threshold_low: null, threshold_high: null });
    const ok = await call('POST', '/definitions', { key: 'travel', name: 'Travel', instructions: 'About a trip?', true_examples: ['Your flight'] });
    expect(ok.status).toBe(201);
  });

  it('cannot rename a key through PATCH, 404s an unknown tag, and refuses to delete the privacy tag', async () => {
    store.updateDefinition.mockResolvedValue({ id: ID, threshold_low: null, threshold_high: null });
    await call('PATCH', `/definitions/${ID}`, { key: 'hacked', name: 'New name' });
    expect(store.updateDefinition).toHaveBeenCalledWith('u1', ID, { name: 'New name' });
    store.updateDefinition.mockResolvedValue(null);
    expect((await call('PATCH', `/definitions/${ID}`, { name: 'x' })).status).toBe(404);
    expect((await call('PATCH', '/definitions/not-a-uuid', { name: 'x' })).status).toBe(400);
    store.deleteDefinition.mockResolvedValue(false);
    expect((await call('DELETE', `/definitions/${ID}`)).status).toBe(404);
  });
});

describe('accounts opt-in', () => {
  it('lists accounts default-off and only toggles accounts the user owns', async () => {
    listUserAccounts.mockResolvedValue([{ id: ID, email_address: 'a@x.example' }]);
    getAccountConfig.mockResolvedValue({});
    expect(await (await call('GET', '/accounts')).json()).toEqual([{ id: ID, email: 'a@x.example', enabled: false }]);
    expect((await call('PUT', `/accounts/${ID2}`, { enabled: true })).status).toBe(404);
    expect((await call('PUT', `/accounts/${ID}`, { enabled: 'yes' })).status).toBe(400);
    expect((await call('PUT', `/accounts/${ID}`, { enabled: true })).status).toBe(200);
    expect(setAccountConfig).toHaveBeenCalledWith('jev-tags', ID, { enabled: true });
  });
});

describe('messages', () => {
  it('limits and validates the batch lookup', async () => {
    expect((await call('GET', '/messages?ids=nope')).status).toBe(400);
    store.tagsForMessages.mockResolvedValue({ [ID]: [] });
    expect((await call('GET', `/messages?ids=${ID}`)).status).toBe(200);
    expect(store.tagsForMessages).toHaveBeenCalledWith('u1', [ID]);
  });

  it('returns every answer plus the run for one message, 404 for another user\'s', async () => {
    store.loadOwnedMessageForTags.mockResolvedValue(null);
    expect((await call('GET', `/messages/${ID}`)).status).toBe(404);
    store.loadOwnedMessageForTags.mockResolvedValue({ id: ID });
    store.tagsForMessages.mockResolvedValue({ [ID]: [{ key: 'urgent', score: 0.2, applied: false }] });
    store.runForMessage.mockResolvedValue({ status: 'done' });
    const json = await (await call('GET', `/messages/${ID}`)).json();
    expect(json.tags).toHaveLength(1);
    expect(json.run.status).toBe('done');
    expect(store.tagsForMessages).toHaveBeenLastCalledWith('u1', [ID], { all: true });
  });

  it('pins a tag manually and reclassifies only with a key and ownership', async () => {
    store.setManualTag.mockResolvedValue(true);
    expect((await call('PUT', `/messages/${ID}/tags/${ID2}`, { applied: true })).status).toBe(200);
    expect((await call('PUT', `/messages/${ID}/tags/${ID2}`, {})).status).toBe(400);
    store.loadOwnedMessageForTags.mockResolvedValue({ id: ID });
    expect((await call('POST', `/messages/${ID}/classify`)).status).toBe(202);
    expect(enqueue).toHaveBeenCalledWith('u1', [ID]);
    enqueue.mockClear();
    store.loadSettings.mockResolvedValue({ apiKey: null });
    expect((await call('POST', `/messages/${ID}/classify`)).status).toBe(400);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('backfills only accounts that opted in', async () => {
    listUserAccounts.mockResolvedValue([{ id: ID }, { id: ID2 }]);
    getAccountConfig.mockImplementation(async (_p, id) => ({ enabled: id === ID }));
    store.inboxMessageIdsToClassify.mockResolvedValue(['m1', 'm2']);
    const res = await call('POST', '/backfill', { limit: 50 });
    expect(res.status).toBe(202);
    expect(store.inboxMessageIdsToClassify).toHaveBeenCalledWith([ID], 50, { includeClassified: false });
    expect((await call('POST', '/backfill', { limit: 9999 })).status).toBe(400);
    expect((await call('POST', '/backfill', { limit: 10, force: 'yes' })).status).toBe(400);
    await call('POST', '/backfill', { limit: 10, force: true });
    expect(store.inboxMessageIdsToClassify).toHaveBeenLastCalledWith([ID], 10, { includeClassified: true });
  });
});
