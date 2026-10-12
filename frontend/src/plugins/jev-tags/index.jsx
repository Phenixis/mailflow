// Jev tags plugin - frontend registrations. The frontend twin of backend/src/services/tags.
// Imported for its side effects by plugins/index.js.
import { registerSlot, registerPluginMeta, registerListParams } from '../registry.js';
import { registerWsHandler } from '../events.js';
import { RowTagPills, HeaderTags } from './TagPills.jsx';
import JevTagsSettings from './JevTagsSettings.jsx';
import { invalidateTags } from './tagStore.js';
import TagFilterBar, { tagListParams, PLUGIN_ID } from './TagFilterBar.jsx';

registerPluginMeta('jev-tags', {
  settingsLocation: { tab: 'categories', subtab: 'jev-tags', labelKey: 'admin.tabs.categories' },
});

// Pills next to the subject in a message-list row. ctx: { message }.
registerSlot('row-subject-badge', { pluginId: 'jev-tags', render: (ctx) => <RowTagPills message={ctx.message} /> });

// Pills + "Why?" panel in the reading-pane header. ctx: { message }.
registerSlot('message-header-badge', { pluginId: 'jev-tags', render: (ctx) => <HeaderTags message={ctx.message} /> });

// Settings block under the Categories tab. ctx: { initialSubTab }.
registerSlot('settings-categories', { pluginId: 'jev-tags', order: 10, render: () => <JevTagsSettings /> });

// Tag chips above the message list, and the `tag` parameter they add to list requests. ctx: { folder }.
registerSlot('message-list-filters', { pluginId: PLUGIN_ID, render: () => <TagFilterBar /> });
registerListParams(PLUGIN_ID, tagListParams);

// Classification finished on the server: refetch the tags of those messages.
registerWsHandler('tags_updated', {
  pluginId: 'jev-tags',
  handler: (data) => invalidateTags(Array.isArray(data.messageIds) ? data.messageIds : []),
});
