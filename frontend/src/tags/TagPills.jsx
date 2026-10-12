import { useEffect, useState } from 'react';
import { useMessageTags } from './tagStore.js';
import TagPickerList from './TagPickerList.jsx';
import { PluginSlot } from '../plugins/PluginSlot.jsx';
import { useT } from './strings.js';

const sourceNote = (tag, t) => (tag.source === 'manual' ? t('source.manual') : t('source.auto', { source: tag.source }));

export function Pill({ tag, small, t }) {
  return (
    <span
      title={t('pill.title', { name: tag.name, source: sourceNote(tag, t) })}
      style={{
        display: 'inline-flex', alignItems: 'center', flexShrink: 0,
        fontSize: small ? 10 : 11, fontWeight: 600, lineHeight: 1,
        padding: small ? '2px 6px' : '3px 8px', borderRadius: 999,
        color: tag.color, background: `${tag.color}1f`, border: `1px solid ${tag.color}55`,
      }}
    >
      {tag.name}
    </span>
  );
}

// Compact pills for a message-list row.
export function RowTagPills({ message }) {
  const t = useT();
  const tags = useMessageTags(message.id);
  if (!tags.length) return null;
  return <span style={{ display: 'inline-flex', gap: 4, flexShrink: 0 }}>{tags.map((tag) => <Pill key={tag.tagId} tag={tag} t={t} small />)}</span>;
}

// Pills in the reading-pane header plus a small editor to add or remove tags by hand. Plugins can add
// their own controls next to it through the 'message-header-badge' slot. Fragment: lives in a flex row.
export function HeaderTags({ message }) {
  const t = useT();
  const tags = useMessageTags(message.id);
  const [open, setOpen] = useState(false);

  useEffect(() => { setOpen(false); }, [message.id]);

  return (
    <>
      {tags.map((tag) => <Pill key={tag.tagId} tag={tag} t={t} />)}
      <button
        onClick={() => setOpen(!open)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 11, padding: '0 2px' }}
      >
        {open ? t('header.hide') : t('header.tags')}
      </button>
      <PluginSlot name="message-header-badge" ctx={{ message }} />
      {open && (
        <div style={{ flexBasis: '100%', fontSize: 12, fontWeight: 400, color: 'var(--text-secondary)' }}>
          <TagPickerList messageIds={[message.id]} />
        </div>
      )}
    </>
  );
}
