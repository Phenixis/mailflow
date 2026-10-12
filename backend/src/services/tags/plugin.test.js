import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../plugins/activation.js', () => ({ isPluginActivatedForAccount: vi.fn() }));
vi.mock('../../plugins/accountConfig.js', () => ({ getAccountConfig: vi.fn(), setAccountConfig: vi.fn() }));
vi.mock('../../middleware/auth.js', () => ({ requireAuth: (_q, _s, n) => n() }));
vi.mock('../mailAccess.js', () => ({ listUserAccounts: vi.fn() }));
vi.mock('./store.js', () => ({}));
const enqueue = vi.hoisted(() => vi.fn());
vi.mock('./queue.js', () => ({ tagQueue: { enqueue } }));

import { isPluginActivatedForAccount } from '../../plugins/activation.js';
import { getAccountConfig } from '../../plugins/accountConfig.js';
import { jevTagsPlugin, tagsEnabledForAccount, inboxIngest } from './plugin.js';
import { createPluginRegistry } from '../../plugins/registry.js';

beforeEach(() => { vi.clearAllMocks(); });

describe('jev-tags plugin', () => {
  it('registers cleanly and mounts at /api/tags', () => {
    const registry = createPluginRegistry();
    expect(() => registry.register(jevTagsPlugin)).not.toThrow();
    expect(jevTagsPlugin.router.base).toBe('/api/tags');
  });

  it('is active only when the user activated the plugin AND the account opted in', async () => {
    isPluginActivatedForAccount.mockResolvedValue(true);
    getAccountConfig.mockResolvedValue({ enabled: true });
    expect(await tagsEnabledForAccount({ account: { id: 'a1' } })).toBe(true);
    getAccountConfig.mockResolvedValue({});
    expect(await tagsEnabledForAccount({ account: { id: 'a1' } })).toBe(false);
    isPluginActivatedForAccount.mockResolvedValue(false);
    getAccountConfig.mockResolvedValue({ enabled: true });
    expect(await tagsEnabledForAccount({ account: { id: 'a1' } })).toBe(false);
    expect(await tagsEnabledForAccount({})).toBe(false);
  });

  it('inboxIngest only enqueues for the account owner and never throws into core', async () => {
    await inboxIngest({ account: { id: 'a1', user_id: 'u1' }, newInboxIds: ['m1', 'm2'] });
    expect(enqueue).toHaveBeenCalledWith('u1', ['m1', 'm2']);
    enqueue.mockClear();
    await inboxIngest({ account: { id: 'a1' }, newInboxIds: ['m1'] });
    await inboxIngest({ account: { id: 'a1', user_id: 'u1' }, newInboxIds: [] });
    expect(enqueue).not.toHaveBeenCalled();
  });
});
