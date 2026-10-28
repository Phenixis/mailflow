import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./db.js', () => ({ query: vi.fn() }));
vi.mock('./inboxRules.js', async () => {
  const real = await vi.importActual('./inboxRules.js');
  return { newMailAlerts: real.newMailAlerts, applyInboxRules: vi.fn(), accountHasTagRules: vi.fn() };
});

const { shouldHoldForTags, stillInFolder, runRulesAfterTags } = await import('./tagDeferredRules.js');

const account = { id: 'acc-1', user_id: 'user-1' };
const msg = (id, extra = {}) => ({ id, uid: Number(id.slice(1)), folder: 'INBOX', isRead: false, is_read: false, ...extra });

beforeEach(() => { vi.useRealTimers(); });

describe('shouldHoldForTags', () => {
  it('holds only when a tagger is active and a rule reads tags', async () => {
    const yes = async () => true;
    const no = async () => false;
    expect(await shouldHoldForTags(account, { hasTagger: yes, hasTagRules: yes })).toBe(true);
    expect(await shouldHoldForTags(account, { hasTagger: no, hasTagRules: yes })).toBe(false);
    expect(await shouldHoldForTags(account, { hasTagger: yes, hasTagRules: no })).toBe(false);
  });

  it('does not ask for the rules when no tagger is active', async () => {
    const hasTagRules = vi.fn();
    await shouldHoldForTags(account, { hasTagger: async () => false, hasTagRules });
    expect(hasTagRules).not.toHaveBeenCalled();
  });

  it('runs the rules at once when it cannot tell', async () => {
    const boom = async () => { throw new Error('db down'); };
    expect(await shouldHoldForTags(account, { hasTagger: async () => true, hasTagRules: boom })).toBe(false);
  });
});

describe('stillInFolder', () => {
  it('keeps messages still in the folder under the same uid, with their current read state', async () => {
    const queryImpl = vi.fn().mockResolvedValue({ rows: [
      { id: 'm1', uid: 1, folder: 'INBOX', is_read: true, is_deleted: false },
      { id: 'm2', uid: 2, folder: 'Archive', is_read: false, is_deleted: false },
      { id: 'm3', uid: 99, folder: 'INBOX', is_read: false, is_deleted: false },
      { id: 'm4', uid: 4, folder: 'INBOX', is_read: false, is_deleted: true },
    ] });
    const out = await stillInFolder([msg('m1'), msg('m2'), msg('m3'), msg('m4'), msg('m5')], { queryImpl });
    expect(out.map(m => m.id)).toEqual(['m1']);
    expect(out[0].isRead).toBe(true);
  });
});

describe('runRulesAfterTags', () => {
  const run = (overrides) => {
    const alert = vi.fn();
    const applyRules = vi.fn(async (messages) => ({ remaining: messages, mutedIds: new Set(), notifyMessages: [] }));
    const refresh = vi.fn(async (messages) => messages);
    const done = runRulesAfterTags({
      account, messages: [msg('m1'), msg('m2')], imapManager: {},
      waitForTags: async () => [], alert, applyRules, refresh, ...overrides,
    });
    return { done, alert, applyRules, refresh };
  };

  it('runs the rules once the tags are in, and alerts for what they leave', async () => {
    const order = [];
    const { done, alert } = run({
      waitForTags: async () => { order.push('tagged'); },
      applyRules: vi.fn(async (messages) => { order.push('rules'); return { remaining: messages, mutedIds: new Set(['m1']), notifyMessages: [] }; }),
    });
    await done;
    expect(order).toEqual(['tagged', 'rules']);
    const [listed, alerts] = alert.mock.calls[0];
    expect(listed.map(m => m.id)).toEqual(['m1', 'm2']);
    expect(alerts.alertMessages.map(m => m.id)).toEqual(['m2']);
  });

  it('tells the clients to refresh even when the rules moved all of it and nothing alerts', async () => {
    const { done, alert } = run({ applyRules: async () => ({ remaining: [], mutedIds: new Set(), notifyMessages: [] }) });
    await done;
    const [listed, alerts] = alert.mock.calls[0];
    expect(listed.map(m => m.id)).toEqual(['m1', 'm2']);
    expect(alerts).toMatchObject({ send: true, alertCount: 0 });
  });

  it('runs the rules anyway when the tagger never finishes', async () => {
    vi.useFakeTimers();
    const { done, applyRules } = run({ waitForTags: () => new Promise(() => {}), timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    await done;
    expect(applyRules).toHaveBeenCalledTimes(1);
  });

  it('runs the rules anyway when the tagger fails', async () => {
    const { done, applyRules } = run({ waitForTags: async () => { throw new Error('jev down'); } });
    await done;
    expect(applyRules).toHaveBeenCalledTimes(1);
  });

  it('leaves mail that is gone alone, and does not alert for mail read meanwhile', async () => {
    const { done, alert, applyRules } = run({ refresh: async () => [msg('m2', { isRead: true, is_read: true })] });
    await done;
    expect(applyRules.mock.calls[0][0].map(m => m.id)).toEqual(['m2']);
    expect(alert.mock.calls[0][1].alertCount).toBe(0);
  });

  it('alerts without rules when the held mail cannot be re-read', async () => {
    const { done, alert, applyRules } = run({ refresh: async () => { throw new Error('db down'); } });
    await done;
    expect(applyRules).not.toHaveBeenCalled();
    expect(alert.mock.calls[0][1].alertCount).toBe(2);
  });

  it('still alerts when the rules throw', async () => {
    const { done, alert } = run({ applyRules: async () => { throw new Error('imap down'); } });
    await done;
    expect(alert.mock.calls[0][1].alertCount).toBe(2);
  });
});
