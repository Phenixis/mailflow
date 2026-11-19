import { useEffect, useState, useSyncExternalStore } from 'react';
import { api } from '../utils/api.js';
import { useStore } from '../store/index.js';
import { useTagDefinitionsRevision } from './tagStore.js';
import { getTagFilter, setTagFilterState, subscribeTagFilter } from './filterState.js';
import { useTranslation } from 'react-i18next';

// Change the filter and make the list reload from the first page.
export function applyTagFilter(next) {
  setTagFilterState(next);
  useStore.setState((s) => ({ messagesRefreshToken: s.messagesRefreshToken + 1, messages: [], messagesOffset: 0, hasMoreMessages: true }));
}

// The selection without the tags that were deleted since: a filter on one would match nothing and leave
// no chip to undo it. Returns the same array when nothing was deleted.
export function withoutDeleted(ids, defs) {
  const kept = ids.filter((id) => defs.some((d) => d.id === id));
  return kept.length === ids.length ? ids : kept;
}

// A row of tag chips above the message list. Clicking chips selects several tags; with two or more
// selected a switch chooses between "any of them" and "all of them".
export default function TagFilterBar() {
  const { t } = useTranslation();
  const { ids, mode } = useSyncExternalStore(subscribeTagFilter, getTagFilter);
  const [defs, setDefs] = useState([]);
  const revision = useTagDefinitionsRevision();
  useEffect(() => { api.tagDefinitions().then(setDefs).catch(() => {}); }, [revision]);

  useEffect(() => {
    const kept = withoutDeleted(ids, defs);
    if (defs.length && kept !== ids) applyTagFilter({ ids: kept });
  });
  if (!defs.length) return null;

  const chip = (selected, color) => ({
    padding: '3px 11px', flexShrink: 0, borderRadius: 100, cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap',
    border: `1px solid ${selected ? color : 'var(--border)'}`, background: selected ? `${color}1f` : 'none',
    color: selected ? color : 'var(--text-secondary)', fontWeight: selected ? 600 : 400,
  });
  const toggle = (id) => applyTagFilter({ ids: ids.includes(id) ? ids.filter((k) => k !== id) : [...ids, id] });

  return (
    <div aria-label={t('tags.filter.label')} style={{ display: 'flex', gap: 6, padding: '6px 10px', overflowX: 'auto', scrollbarWidth: 'none', flexShrink: 0, borderBottom: '1px solid var(--border-subtle)' }}>
      <button style={chip(!ids.length, 'var(--accent)')} onClick={() => applyTagFilter({ ids: [] })}>{t('tags.filter.all')}</button>
      {defs.map((d) => (
        <button key={d.id} style={chip(ids.includes(d.id), d.color)} onClick={() => toggle(d.id)}>{d.name}</button>
      ))}
      {ids.length > 1 && (
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
