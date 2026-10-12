import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';

vi.mock('../middleware/auth.js', () => ({ requireAuth: (req, _res, next) => { req.session = { userId: 'u1' }; next(); } }));
const broadcast = vi.hoisted(() => vi.fn());
vi.mock('../index.js', () => ({ imapManager: { broadcast } }));
vi.mock('../services/tags/store.js', () => ({
  KEY_RE: /^[a-z][a-z0-9_]{0,39}$/,
  listDefinitions: vi.fn(), createDefinition: vi.fn(), updateDefinition: vi.fn(), deleteDefinition: vi.fn(),
  tagsForMessages: vi.fn(), setManualTag: vi.fn(), setManualTags: vi.fn(),
}));

import 'express-async-errors';
import express from 'express';
import * as store from '../services/tags/store.js';
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
beforeEach(() => { vi.clearAllMocks(); });
const call = (method, path, body) => fetch(base + path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });

describe('definitions', () => {
  it('validates a new tag and refuses a duplicate key', async () => {
    store.listDefinitions.mockResolvedValue([{ key: 'urgent' }]);
    expect((await call('POST', '/definitions', { name: 'X' })).status).toBe(400);
    expect((await call('POST', '/definitions', { key: 'Bad Key', name: 'X' })).status).toBe(400);
    expect((await call('POST', '/definitions', { key: 'x', name: 'X', color: 'red' })).status).toBe(400);
    expect((await call('POST', '/definitions', { key: 'urgent', name: 'X' })).status).toBe(409);
    store.createDefinition.mockResolvedValue({ id: ID, key: 'travel' });
    const ok = await call('POST', '/definitions', { key: 'travel', name: 'Travel', color: '#00aa00' });
    expect(ok.status).toBe(201);
    expect(store.createDefinition).toHaveBeenCalledWith('u1', { key: 'travel', name: 'Travel', color: '#00aa00' });
  });

  it('cannot rename a key through PATCH, and 404s an unknown tag or id', async () => {
    store.updateDefinition.mockResolvedValue({ id: ID });
    await call('PATCH', `/definitions/${ID}`, { key: 'hacked', name: 'New name' });
    expect(store.updateDefinition).toHaveBeenCalledWith('u1', ID, { name: 'New name' });
    store.updateDefinition.mockResolvedValue(null);
    expect((await call('PATCH', `/definitions/${ID}`, { name: 'x' })).status).toBe(404);
    expect((await call('PATCH', '/definitions/not-a-uuid', { name: 'x' })).status).toBe(400);
    expect((await call('PATCH', `/definitions/${ID}`, { enabled: 'yes' })).status).toBe(400);
    store.deleteDefinition.mockResolvedValue(false);
    expect((await call('DELETE', `/definitions/${ID}`)).status).toBe(404);
    store.deleteDefinition.mockResolvedValue(true);
    expect((await call('DELETE', `/definitions/${ID}`)).status).toBe(200);
  });
});

describe('messages', () => {
  it('validates and limits the batch lookup', async () => {
    expect((await call('GET', '/messages?ids=nope')).status).toBe(400);
    expect((await call('GET', `/messages?ids=${Array(201).fill(ID).join(',')}`)).status).toBe(400);
    store.tagsForMessages.mockResolvedValue({ [ID]: [] });
    expect((await call('GET', `/messages?ids=${ID}`)).status).toBe(200);
    expect(store.tagsForMessages).toHaveBeenCalledWith('u1', [ID]);
  });

  it('adds or removes a tag by hand, tells the open tabs, and 404s a message or tag that is not the user\'s', async () => {
    store.setManualTag.mockResolvedValue(true);
    expect((await call('PUT', `/messages/${ID}/tags/${ID2}`, { applied: false })).status).toBe(200);
    expect(store.setManualTag).toHaveBeenCalledWith('u1', ID, ID2, false);
    expect(broadcast).toHaveBeenCalledWith({ type: 'tags_updated', messageIds: [ID] }, 'u1');
    expect((await call('PUT', `/messages/${ID}/tags/${ID2}`, {})).status).toBe(400);
    store.setManualTag.mockResolvedValue(false);
    broadcast.mockClear();
    expect((await call('PUT', `/messages/${ID}/tags/${ID2}`, { applied: true })).status).toBe(404);
    expect(broadcast).not.toHaveBeenCalled();
  });
});

describe('bulk', () => {
  it('validates the request, applies to the messages that are the user\'s, and tells the open tabs which', async () => {
    expect((await call('POST', '/messages/bulk', { messageIds: [], tagId: ID2, applied: true })).status).toBe(400);
    expect((await call('POST', '/messages/bulk', { messageIds: ['nope'], tagId: ID2, applied: true })).status).toBe(400);
    expect((await call('POST', '/messages/bulk', { messageIds: Array(201).fill(ID), tagId: ID2, applied: true })).status).toBe(400);
    expect((await call('POST', '/messages/bulk', { messageIds: [ID], tagId: 'x', applied: true })).status).toBe(400);
    expect((await call('POST', '/messages/bulk', { messageIds: [ID], tagId: ID2 })).status).toBe(400);
    store.setManualTags.mockResolvedValue([ID]);
    const res = await call('POST', '/messages/bulk', { messageIds: [ID, ID2], tagId: ID2, applied: true });
    expect(await res.json()).toEqual({ updated: 1 });
    expect(store.setManualTags).toHaveBeenCalledWith('u1', [ID, ID2], ID2, true);
    expect(broadcast).toHaveBeenCalledWith({ type: 'tags_updated', messageIds: [ID] }, 'u1');
    store.setManualTags.mockResolvedValue([]);
    broadcast.mockClear();
    expect((await call('POST', '/messages/bulk', { messageIds: [ID], tagId: ID2, applied: false })).status).toBe(404);
    expect(broadcast).not.toHaveBeenCalled();
  });
});
