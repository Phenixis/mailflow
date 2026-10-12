import { useEffect } from 'react';
import TagPickerList from './TagPickerList.jsx';
import { useTranslation } from 'react-i18next';

// The keyboard tag picker: a small centered panel for the selected message. 1-9 toggle the nth tag,
// Escape or a click outside closes it. Opened by the 'openTagPicker' shortcut (see MailApp).
export default function TagPickerPopup({ message, onClose }) {
  const { t } = useTranslation();
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 5000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '15vh' }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ minWidth: 280, maxWidth: 380, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: 'var(--shadow-modal)', overflow: 'hidden' }}
      >
        <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: 12, fontWeight: 600 }}>{t('tags.title')}</div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{message.subject}</div>
        </div>
        <TagPickerList messageIds={[message.id]} hotkeys />
      </div>
    </div>
  );
}
