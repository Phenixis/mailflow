import { useEffect, useState, useSyncExternalStore } from 'react';
import { api } from '../utils/api.js';
import { useStore } from '../store/index.js';
import { getTagFilter, setTagFilterState, subscribeTagFilter } from './filterState.js';
import { useTranslation } from 'react-i18next';

// Change the filter and make the list reload from the first page.
export function applyTagFilter(next) {
  setTagFilterState(next);
  useStore.setState((s) => ({ messagesRefreshToken: s.messagesRefreshToken + 1, messages: [], messagesOffset: 0, hasMoreMessages: true }));
}

// A row of tag chips above the message list. Clicking chips selects several tags; with two or more
// selected a switch chooses between "any of them" and "all of them".
export default function TagFilterBar() {
  const { t } = useTranslation();
  const { keys, mode } = useSyncExternalStore(subscribeTagFilter, getTagFilter);
  const [defs, setDefs] = useState([]);
  useEffect(() => { api.tagDefinitions().then((d) => setDefs(d.filter((x) => x.enabled))).catch(() => {}); }, []);
  if (!defs.length) return null;

  const chip = (selected, color) => ({
    padding: '3px 11px', flexShrink: 0, borderRadius: 100, cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap',
    border: `1px solid ${selected ? color : 'var(--border)'}`, background: selected ? `${color}1f` : 'none',
    color: selected ? color : 'var(--text-secondary)', fontWeight: selected ? 600 : 400,
  });
  const toggle = (key) => applyTagFilter({ keys: keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key] });

  return (
    <div aria-label={t('tags.filter.label')} style={{ display: 'flex', gap: 6, padding: '6px 10px', overflowX: 'auto', scrollbarWidth: 'none', flexShrink: 0, borderBottom: '1px solid var(--border-subtle)' }}>
      <button style={chip(!keys.length, 'var(--accent)')} onClick={() => applyTagFilter({ keys: [] })}>{t('tags.filter.all')}</button>
      {defs.map((d) => (
        <button key={d.id} style={chip(keys.includes(d.key), d.color)} onClick={() => toggle(d.key)}>{d.name}</button>
      ))}
      {keys.length > 1 && (
        <button
          title={t('tags.filter.modeHint')}
          style={{ ...chip(false, 'var(--accent)'), marginLeft: 'auto', color: 'var(--text-primary)' }}
          onClick={() => applyTagFilter({ mode: mode === 'any' ? 'all' : 'any' })}
        >
          {t(mode === 'any' ? 'tags.filter.modeAny' : 'tags.filter.modeAll')}
        </button>
      )}
    </div>
  );
}
