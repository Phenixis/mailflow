import { useEffect, useState } from 'react';
import { useTagStore, requestTags, invalidateTags } from './tagStore.js';
import { api } from '../../utils/api.js';
import { useT } from './strings.js';

const sourceNote = (tag, t) => t(tag.source === 'manual' ? 'source.manual' : tag.bodySent ? 'source.body' : 'source.subject');

export function useMessageTags(messageId) {
  const tags = useTagStore((s) => s.byMessage[messageId]);
  useEffect(() => { if (messageId) requestTags(messageId); }, [messageId]);
  return tags || [];
}

export function Pill({ tag, small, t }) {
  const score = tag.score === null ? '' : ` (${tag.score.toFixed(2)})`;
  return (
    <span
      title={t('pill.title', { name: tag.name, score, source: sourceNote(tag, t) })}
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

// Compact pills for a message-list row. ctx: { message }.
export function RowTagPills({ message }) {
  const t = useT();
  const tags = useMessageTags(message.id);
  if (!tags.length) return null;
  return <span style={{ display: 'inline-flex', gap: 4, flexShrink: 0 }}>{tags.map((tag) => <Pill key={tag.tagId} tag={tag} t={t} small />)}</span>;
}

// Pills in the reading-pane header, with a "Why?" panel listing every Jev answer. ctx: { message }.
export function HeaderTags({ message }) {
  const t = useT();
  const tags = useMessageTags(message.id);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => { setOpen(false); setDetail(null); setError(null); }, [message.id]);

  const load = async () => {
    try { setDetail(await api.tagMessageDetail(message.id)); setError(null); } catch (e) { setError(e.message); }
  };
  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next) await load();
  };
  const pin = async (row) => {
    await api.tagPin(message.id, row.tagId, !row.applied);
    invalidateTags([message.id]);
    await load();
  };
  const reclassify = async () => {
    try { await api.tagReclassify(message.id); setError(null); setTimeout(load, 2500); } catch (e) { setError(e.message); }
  };

  return (
    <>
      {tags.map((tag) => <Pill key={tag.tagId} tag={tag} t={t} />)}
      <button
        onClick={toggle}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 11, padding: '0 2px' }}
      >
        {open ? t('header.hide') : tags.length ? t('header.why') : t('header.tags')}
      </button>
      {open && (
        <div style={{ flexBasis: '100%', fontSize: 12, fontWeight: 400, fontFamily: 'var(--font-body, inherit)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', background: 'var(--bg-secondary)' }}>
          {error && <div style={{ color: 'var(--red, #ef4444)' }}>{error}</div>}
          {detail && !detail.tags.length && <div>{t('header.none')}</div>}
          {detail?.tags.map((row) => (
            <div key={row.tagId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
              <span style={{ width: 90, fontWeight: row.applied ? 600 : 400, color: row.applied ? row.color : undefined }}>{row.name}</span>
              <span style={{ width: 44, fontVariantNumeric: 'tabular-nums' }}>{row.score === null ? '-' : row.score.toFixed(2)}</span>
              <span style={{ flex: 1, color: 'var(--text-tertiary)' }}>{row.applied ? t('header.applied') : t('header.notApplied')} - {sourceNote(row, t)}</span>
              <button onClick={() => pin(row)} style={{ fontSize: 11, cursor: 'pointer' }}>{row.applied ? t('header.remove') : t('header.add')}</button>
            </div>
          ))}
          {detail?.run && (
            <div style={{ marginTop: 4, color: 'var(--text-tertiary)' }}>
              {detail.run.status === 'error' ? t('header.runFailed', { error: detail.run.error }) : `${t(detail.run.body_sent ? 'header.runBody' : 'header.runNoBody')}${detail.run.is_private ? t('header.runPrivate') : ''} - ${t('header.runTokens', { n: detail.run.input_tokens ?? 0 })}`}
            </div>
          )}
          <button onClick={reclassify} style={{ marginTop: 6, fontSize: 11, cursor: 'pointer' }}>{t('header.reclassify')}</button>
        </div>
      )}
    </>
  );
}
