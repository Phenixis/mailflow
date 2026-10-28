// Inbox rules that read tags, on an account where a plugin tags new mail off the sync path (jev-tags).
//
// The rules normally run inside the sync, before the plugin has seen the mail, so a tag condition would
// never match. When an account has both, the sync holds its new Inbox mail instead: the mail is listed at
// once, but the rules and the alert wait until the plugin reports the mail tagged, or TAG_WAIT_MS at most.
// Either way they then run: a slow or failing tagger delays the rules and the alert, it never drops them.
import { query } from './db.js';
import { applyInboxRules, accountHasTagRules, newMailAlerts } from './inboxRules.js';

export const TAG_WAIT_MS = 120_000;

// Hold only when both are true, so an account without tag rules keeps its rules and alerts instant.
export async function shouldHoldForTags(account, { hasTagger, hasTagRules = accountHasTagRules }) {
  try {
    if (!(await hasTagger())) return false;
    return await hasTagRules(account.user_id, account.id);
  } catch (err) {
    console.error('tagDeferredRules: could not tell whether to wait for tags — rules run now:', err.message);
    return false;
  }
}

// The held messages still in the folder, under the same uid, with their read state as it is now. A
// message the user moved or deleted in the meantime is left alone: the rules act on a uid, and must not
// act on one that no longer names this message.
export async function stillInFolder(messages, { queryImpl = query } = {}) {
  if (!messages.length) return [];
  const { rows } = await queryImpl(
    'SELECT id, uid, folder, is_read, is_deleted FROM messages WHERE id = ANY($1::uuid[])',
    [messages.map(m => m.id)]
  );
  const byId = new Map(rows.map(r => [r.id, r]));
  return messages.flatMap((msg) => {
    const row = byId.get(msg.id);
    if (!row || row.is_deleted || row.folder !== msg.folder || Number(row.uid) !== Number(msg.uid)) return [];
    return [{ ...msg, isRead: !!row.is_read, is_read: !!row.is_read }];
  });
}

function waitAtMost(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(true), ms); timer.unref?.(); });
  return Promise.race([Promise.resolve(promise).then(() => false, () => false), timeout])
    .finally(() => clearTimeout(timer));
}

// Wait for the tags, then run the rules on what is still there and alert for what they leave unread and
// unsilenced. `alert(messages, alerts)` publishes the result (list refresh, toast, push).
export async function runRulesAfterTags({
  account, messages, waitForTags, alert, imapManager,
  timeoutMs = TAG_WAIT_MS, refresh = stillInFolder, applyRules = applyInboxRules,
}) {
  const timedOut = await waitAtMost(waitForTags(), timeoutMs);
  if (timedOut) {
    console.warn(`tagDeferredRules: tags for ${messages.length} new message(s) of account ${account.id} not ready after ${timeoutMs}ms — running the rules without them`);
  }

  let current;
  try {
    current = await refresh(messages);
  } catch (err) {
    // Without knowing what is still there the rules cannot run safely; still alert for the mail itself.
    console.error('tagDeferredRules: could not re-read the held messages — alerting without rules:', err.message);
    return alert(messages, newMailAlerts({ remaining: messages }));
  }
  if (!current.length) return undefined;

  let result = { remaining: current, mutedIds: new Set(), notifyMessages: [] };
  try {
    result = await applyRules(current, account, imapManager);
  } catch (err) {
    console.error('inboxRules error (after tags):', err.message);
  }
  // Mail read elsewhere while it was held needs no alert any more.
  const alerts = newMailAlerts({
    remaining: result.remaining.filter(m => !m.isRead),
    mutedIds: result.mutedIds,
    notifyMessages: (result.notifyMessages || []).filter(m => !m.isRead),
  });
  // The held mail is already listed, and a rule that moved it does not tell the clients: always send, so
  // they refresh.
  return alert(current, { ...alerts, send: true });
}
