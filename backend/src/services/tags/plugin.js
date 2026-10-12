// jev-tags plugin manifest. Core fires `inboxIngest` for new INBOX mail; this enqueues the
// messages for classification and returns at once (the queue runs Jev off the sync path).
// Active per user (Settings -> Plugins) AND per account (opt-in), so nothing is sent otherwise.
import tagsRoutes from '../../routes/tags.js';
import { isPluginActivatedForAccount } from '../../plugins/activation.js';
import { getAccountConfig } from '../../plugins/accountConfig.js';
import { tagQueue } from './queue.js';
import { PLUGIN_ID } from './defaults.js';

export async function tagsEnabledForAccount(ctx) {
  const id = ctx?.account?.id;
  if (!id) return false;
  if (!(await isPluginActivatedForAccount(PLUGIN_ID, id))) return false;
  return Boolean((await getAccountConfig(PLUGIN_ID, id)).enabled);
}

export async function inboxIngest({ account, newInboxIds }) {
  if (!account?.user_id || !newInboxIds?.length) return;
  tagQueue.enqueue(account.user_id, newInboxIds);
}

export const jevTagsPlugin = {
  id: PLUGIN_ID,
  name: 'Jev tags',
  version: '0.1.0',
  tier: 1,
  router: { base: '/api/tags', handler: tagsRoutes },
  hooks: { inboxIngest: { handler: inboxIngest, isActive: tagsEnabledForAccount } },
};
