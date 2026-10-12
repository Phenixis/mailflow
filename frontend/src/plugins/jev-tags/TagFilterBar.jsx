import { useEffect, useState } from 'react';
import { api } from '../../utils/api.js';
import { useStore } from '../../store/index.js';
import { useTagStore } from './tagStore.js';
import { useT } from './strings.js';

export const PLUGIN_ID = 'jev-tags';

// The `tag` parameter added to every message-list request while a tag filter is on.
export function tagListParams() {
  const active = useStore.getState().enabledPlugins.includes(PLUGIN_ID) ? useTagStore.getState().activeFilter : null;
  return active ? { tag: active } : {};
}

// Set (or clear) the filter and make the list reload from the first page.
export function setTagFilter(key) {
  useTagStore.setState({ activeFilter: key });
  useStore.setState((s) => ({ messagesRefreshToken: s.messagesRefreshToken + 1, messages: [], messagesOffset: 0, hasMoreMessages: true }));
}

// A row of tag chips above the message list. ctx: { folder }.
export default function TagFilterBar() {
  const t = useT();
  const active = useTagStore((s) => s.activeFilter);
  const [defs, setDefs] = useState([]);
  useEffect(() => { api.tagDefinitions().then((d) => setDefs(d.filter((x) => x.enabled))).catch(() => {}); }, []);
  if (!defs.length) return null;

  const chip = (selected, color) => ({
    padding: '3px 11px', flexShrink: 0, borderRadius: 100, cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap',
    border: `1px solid ${selected ? color : 'var(--border)'}`, background: selected ? `${color}1f` : 'none',
    color: selected ? color : 'var(--text-secondary)', fontWeight: selected ? 600 : 400,
  });
  return (
    <div aria-label={t('filter.label')} style={{ display: 'flex', gap: 6, padding: '6px 10px', overflowX: 'auto', scrollbarWidth: 'none', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-subtle)' }}>
      <button style={chip(!active, 'var(--accent)')} onClick={() => setTagFilter(null)}>{t('filter.all')}</button>
      {defs.map((d) => (
        <button key={d.id} style={chip(active === d.key, d.color)} onClick={() => setTagFilter(active === d.key ? null : d.key)}>{d.name}</button>
      ))}
    </div>
  );
}
