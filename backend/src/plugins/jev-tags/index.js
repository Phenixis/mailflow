// Jev tags plugin manifest (Tier-1). Auto-assigns the user's tags to incoming mail with TypeSafe's
// Jev model. Core fires `inboxIngest` for new INBOX mail; this enqueues the messages and returns at
// once (the queue runs Jev off the sync path). Active per user (Settings -> Plugins) AND per account
// (opt-in), so nothing is sent otherwise. Core makes the only network call, to the declared host.
import routes from './routes.js';
import { jevQueue } from './queue.js';
import { isPluginActivatedForAccount, getAccountConfig } from '../api.js';
import { PLUGIN_ID, JEV_HOST } from './defaults.js';

export async function jevEnabledForAccount(ctx) {
  const id = ctx?.account?.id;
  if (!id) return false;
  if (!(await isPluginActivatedForAccount(PLUGIN_ID, id))) return false;
  return Boolean((await getAccountConfig(PLUGIN_ID, id)).enabled);
}

export async function inboxIngest({ account, newInboxIds }) {
  if (!account?.user_id || !newInboxIds?.length) return;
  jevQueue.enqueue(account.user_id, newInboxIds);
}

// Core holds new mail whose rules read tags until it is tagged: queue it (if inboxIngest has not yet) and
// resolve once Jev is done with it.
export async function awaitTags({ account, messageIds }) {
  if (!account?.user_id || !messageIds?.length) return;
  jevQueue.enqueue(account.user_id, messageIds);
  await jevQueue.settled(messageIds);
}

export const jevTagsPlugin = {
  id: PLUGIN_ID,
  name: 'Jev tags',
  version: '0.2.0',
  tier: 1,
  network: { hosts: [JEV_HOST] },
  router: { base: '/api/jev-tags', handler: routes },
  hooks: {
    inboxIngest: { handler: inboxIngest, isActive: jevEnabledForAccount },
    awaitTags: { handler: awaitTags, isActive: jevEnabledForAccount },
  },
};
