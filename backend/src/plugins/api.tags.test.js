import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => ({ listDefinitions: vi.fn(), ensureDefinition: vi.fn(), applyTag: vi.fn(), removeTag: vi.fn(), listInboxMessageIds: vi.fn() }));
vi.mock('../services/tags/store.js', () => store);
const broadcast = vi.hoisted(() => vi.fn());
vi.mock('./mailEngine.js', () => ({ getMailEngine: () => ({ broadcast }) }));
vi.mock('../services/db.js', () => ({ query: vi.fn(), pool: {} }));

import { applyTag, removeTag } from './api.js';

beforeEach(() => vi.clearAllMocks());

describe('tag capabilities of the plugin API', () => {
  it('applyTag passes the plugin id as the source and tells the open tabs only when a tag was added', async () => {
    store.applyTag.mockResolvedValueOnce('applied').mockResolvedValueOnce('unchanged').mockResolvedValueOnce('skipped');
    expect(await applyTag('jev-tags', 'u1', 'm1', 'urgent')).toBe('applied');
    expect(store.applyTag).toHaveBeenCalledWith('u1', 'm1', 'urgent', 'jev-tags');
    expect(broadcast).toHaveBeenCalledWith({ type: 'tags_updated', messageIds: ['m1'] }, 'u1');
    broadcast.mockClear();
    await applyTag('jev-tags', 'u1', 'm1', 'urgent');
    await applyTag('jev-tags', 'u1', 'm1', 'urgent');
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('removeTag only removes the plugin\'s own tag and broadcasts on change', async () => {
    store.removeTag.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await removeTag('jev-tags', 'u1', 'm1', 'urgent')).toBe(true);
    expect(store.removeTag).toHaveBeenCalledWith('u1', 'm1', 'urgent', 'jev-tags');
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(await removeTag('jev-tags', 'u1', 'm1', 'urgent')).toBe(false);
    expect(broadcast).toHaveBeenCalledTimes(1);
  });
});
