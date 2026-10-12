import { useEffect, useState } from 'react';
import { api } from '../../utils/api.js';
import { useTranslation } from 'react-i18next';

// "Why?" next to a message's tags: every answer Jev gave, how the run went, and Reclassify.
// Rendered in the 'message-header-badge' slot (a fragment inside the header's flex row).
export default function JevWhy({ message }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => { setOpen(false); setDetail(null); setError(null); }, [message.id]);

  const load = async () => {
    try { setDetail(await api.jevWhy(message.id)); setError(null); } catch (e) { setError(e.message); }
  };
  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next) await load();
  };
  const reclassify = async () => {
    try { await api.jevReclassify(message.id); setError(null); setTimeout(load, 2500); } catch (e) { setError(e.message); }
  };
  const sent = (a) => t(a.bodySent ? 'jevTags.why.body' : 'jevTags.why.subject');

  return (
    <>
      <button onClick={toggle} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 11, padding: '0 2px' }}>
        {open ? t('jevTags.why.hide') : t('jevTags.why.show')}
      </button>
      {open && (
        <div style={{ flexBasis: '100%', fontSize: 12, fontWeight: 400, color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', background: 'var(--bg-secondary)' }}>
          {error && <div style={{ color: 'var(--red, #ef4444)' }}>{error}</div>}
          {detail && !detail.answers.length && !detail.run && <div>{t('jevTags.why.none')}</div>}
          {detail?.answers.map((a) => (
            <div key={a.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
              <span style={{ width: 90, fontWeight: a.applied ? 600 : 400, color: a.applied ? a.color : undefined }}>{a.name}</span>
              <span style={{ width: 44, fontVariantNumeric: 'tabular-nums' }}>{a.score === null ? '-' : a.score.toFixed(2)}</span>
              <span style={{ flex: 1, color: 'var(--text-tertiary)' }}>{a.applied ? t('jevTags.why.applied') : t('jevTags.why.notApplied')} - {sent(a)}</span>
            </div>
          ))}
          {detail?.run && (
            <div style={{ marginTop: 4, color: 'var(--text-tertiary)' }}>
              {detail.run.status === 'error'
                ? t('jevTags.why.runFailed', { error: detail.run.error })
                : `${t(detail.run.isPrivate ? 'jevTags.why.runPrivate' : detail.run.bodySent ? 'jevTags.why.runBody' : 'jevTags.why.runNoBody')} - ${t('jevTags.why.runTokens', { n: detail.run.input ?? 0 })}`}
            </div>
          )}
          <button onClick={reclassify} style={{ marginTop: 6, fontSize: 11, cursor: 'pointer' }}>{t('jevTags.why.reclassify')}</button>
        </div>
      )}
    </>
  );
}
