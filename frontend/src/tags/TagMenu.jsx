import TagPickerList from './TagPickerList.jsx';
import { useTranslation } from 'react-i18next';

// The Tags submenu of the message context menu: a back row, then the tags to toggle. `targetIds` are
// the messages it acts on (the clicked one, or every selected row when the click was on a selection).
export default function TagMenu({ targetIds, onBack }) {
  const { t } = useTranslation();
  return (
    <>
      <div
        onClick={onBack}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', cursor: 'pointer',
          borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', fontSize: 12,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0 }}>
          <polyline points="15 18 9 12 15 6" />
        </svg>
        <span>{t('tags.title')}</span>
      </div>
      <TagPickerList messageIds={targetIds} />
    </>
  );
}
