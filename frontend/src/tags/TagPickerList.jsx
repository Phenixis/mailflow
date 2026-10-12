import { useEffect, useState } from 'react';
import { api } from '../utils/api.js';
import { useMessageTags, useTagCounts, invalidateTags } from './tagStore.js';
import { useStore } from '../store/index.js';
import { useTranslation } from 'react-i18next';

// The user's tags as a list to put on or take off the given messages. One message: a checkbox per
// tag (and keys 1-9 toggle the nth tag when `hotkeys` is set). Several: "add" and "remove" per tag,
// applied to all of them. Used by the context menu, the bulk toolbar and the keyboard picker.
export default function TagPickerList({ messageIds, hotkeys = false }) {
  const { t } = useTranslation();
  const [defs, setDefs] = useState(null);
  const [error, setError] = useState(null);
  const single = messageIds.length === 1;
  const current = useMessageTags(messageIds[0]);
  const counts = useTagCounts(messageIds);

  useEffect(() => { api.tagDefinitions().then((d) => setDefs(d.filter((x) => x.enabled))).catch((e) => setError(e.message)); }, []);

  // Several messages get a toast saying what changed (the checkbox is feedback enough for one).
  const notify = (title, type) => useStore.getState().addNotification({ type, title, body: '' });
  const apply = async (def, on) => {
    try {
      const { updated } = await api.tagBulk(messageIds, def.id, on);
      invalidateTags(messageIds);
      setError(null);
      if (!single) notify(t(on ? 'tags.toast.added' : 'tags.toast.removed', { name: def.name, n: updated }));
    } catch (e) {
      setError(e.message);
      notify(t('tags.toast.failed', { error: e.message }), 'error');
    }
  };

  useEffect(() => {
    if (!hotkeys || !defs) return undefined;
    const onKey = (e) => {
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > defs.length || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
      const def = defs[n - 1];
      apply(def, single ? !current.some((x) => x.tagId === def.id) : true);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  });

  const row = { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', fontSize: 13, color: 'var(--text-primary)' };
  const small = { fontSize: 11, padding: '2px 8px', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer', background: 'transparent', color: 'var(--text-primary)' };
  if (!defs) return <div style={{ ...row, color: 'var(--text-tertiary)' }}>{error || '...'}</div>;
  if (!defs.length) return <div style={{ ...row, color: 'var(--text-tertiary)' }}>{t('tags.header.none')}</div>;

  return (
    <div>
      {defs.map((def, i) => {
        const on = current.some((x) => x.tagId === def.id);
        return (
          <div key={def.id} style={row}>
            {single ? (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, cursor: 'pointer' }}>
                <input type="checkbox" checked={on} onChange={() => apply(def, !on)} />
                <span style={{ width: 9, height: 9, borderRadius: 3, background: def.color }} />
                <span style={{ flex: 1 }}>{def.name}</span>
              </label>
            ) : (
              <>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: def.color }} />
                <span style={{ flex: 1 }}>
                  {def.name}
                  <span style={{ marginLeft: 6, fontSize: 11, color: counts[def.id] ? 'var(--accent)' : 'var(--text-tertiary)' }}>
                    {t('tags.picker.count', { n: counts[def.id] || 0, total: messageIds.length })}
                  </span>
                </span>
                <button style={small} onClick={() => apply(def, true)}>{t('common.add')}</button>
                <button style={small} onClick={() => apply(def, false)}>{t('common.remove')}</button>
              </>
            )}
            {hotkeys && i < 9 && <kbd style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{i + 1}</kbd>}
          </div>
        );
      })}
      {error && <div style={{ ...row, color: 'var(--red, #ef4444)' }}>{error}</div>}
    </div>
  );
}
