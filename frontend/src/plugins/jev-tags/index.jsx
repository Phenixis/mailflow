// Jev tags plugin - frontend registrations. The frontend twin of backend/src/plugins/jev-tags.
// Tags themselves (pills, filter, manual editing, tag list) are core; this adds Jev's settings and
// the "Why?" explanation. Imported for its side effects by plugins/index.js.
import { registerSlot, registerPluginMeta } from '../registry.js';
import JevWhy from './JevWhy.jsx';
import JevSettings from './JevSettings.jsx';

registerPluginMeta('jev-tags', {
  settingsLocation: { tab: 'categories', subtab: 'jev-tags', labelKey: 'admin.tabs.categories' },
});

// "Why?" next to a message's tags in the reading-pane header. ctx: { message }.
registerSlot('message-header-badge', { pluginId: 'jev-tags', render: (ctx) => <JevWhy message={ctx.message} /> });

// Settings block under the Categories tab. ctx: { initialSubTab }.
registerSlot('settings-categories', { pluginId: 'jev-tags', order: 10, render: () => <JevSettings /> });
