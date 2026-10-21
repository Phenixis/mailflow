import { describe, it, expect, vi, beforeEach } from 'vitest';

const api = vi.hoisted(() => ({
  isPluginActivatedForAccount: vi.fn(), getAccountConfig: vi.fn(), requireAuth: (_q, _s, n) => n(),
  listUserAccounts: vi.fn(), setAccountConfig: vi.fn(), loadOwnedMessage: vi.fn(), getMessageAnnotations: vi.fn(),
  listTagDefinitions: vi.fn(), listInboxMessageIds: vi.fn(), logger: { warn: vi.fn() },
}));
vi.mock('../api.js', () => api);
vi.mock('./config.js', () => ({}));
const enqueue = vi.hoisted(() => vi.fn());
vi.mock('./queue.js', () => ({ jevQueue: { enqueue } }));

import { jevTagsPlugin, jevEnabledForAccount, inboxIngest } from './index.js';
import { createPluginRegistry } from '../registry.js';

beforeEach(() => { vi.clearAllMocks(); });

describe('jev-tags plugin', () => {
  it('registers cleanly, mounts at /api/jev-tags and declares only the Jev host', () => {
    expect(() => createPluginRegistry().register(jevTagsPlugin)).not.toThrow();
    expect(jevTagsPlugin.router.base).toBe('/api/jev-tags');
    expect(jevTagsPlugin.network).toEqual({ hosts: ['api.typesafe.ai'] });
  });

  it('is active only when the user activated the plugin AND the account opted in', async () => {
    api.isPluginActivatedForAccount.mockResolvedValue(true);
    api.getAccountConfig.mockResolvedValue({ enabled: true });
    expect(await jevEnabledForAccount({ account: { id: 'a1' } })).toBe(true);
    api.getAccountConfig.mockResolvedValue({});
    expect(await jevEnabledForAccount({ account: { id: 'a1' } })).toBe(false);
    api.isPluginActivatedForAccount.mockResolvedValue(false);
    api.getAccountConfig.mockResolvedValue({ enabled: true });
    expect(await jevEnabledForAccount({ account: { id: 'a1' } })).toBe(false);
    expect(await jevEnabledForAccount({})).toBe(false);
  });

  it('inboxIngest only enqueues for the account owner', async () => {
    await inboxIngest({ account: { id: 'a1', user_id: 'u1' }, newInboxIds: ['m1', 'm2'] });
    expect(enqueue).toHaveBeenCalledWith('u1', ['m1', 'm2']);
    enqueue.mockClear();
    await inboxIngest({ account: { id: 'a1' }, newInboxIds: ['m1'] });
    await inboxIngest({ account: { id: 'a1', user_id: 'u1' }, newInboxIds: [] });
    expect(enqueue).not.toHaveBeenCalled();
  });
});
