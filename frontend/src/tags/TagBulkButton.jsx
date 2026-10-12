import { useState } from 'react';
import { createPortal } from 'react-dom';
import TagPickerList from './TagPickerList.jsx';
import { useMobile } from '../hooks/useMobile.js';
import { useT } from './strings.js';

// The "Tags" button of the bulk-selection toolbar. `Btn` is the toolbar's own button component, so
// it looks like its neighbours; clicking opens a small popover to add or remove tags on all `ids`.
export default function TagBulkButton({ ids, Btn }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const isMobile = useMobile();
  const list = <TagPickerList messageIds={ids} />;

  return (
    <div style={{ position: 'relative' }}>
      <Btn title={t('menu.tags')} onClick={() => setOpen(!open)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
          <line x1="7" y1="7" x2="7.01" y2="7" />
        </svg>
      </Btn>
      {open && !isMobile && (
        <>
          <div onClick={() => setOpen(false)} aria-hidden style={{ position: 'fixed', inset: 0, zIndex: 999 }} />
          <div style={{
            position: 'absolute', top: '100%', right: 0, zIndex: 1000, minWidth: 240, maxHeight: 320, overflowY: 'auto',
            background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: 'var(--shadow-popover)',
          }}>
            {list}
          </div>
        </>
      )}
      {/* A phone gets a bottom sheet. It is rendered on <body>: inside the sticky toolbar it would be
          stuck under the compose button, whose layer sits above the toolbar's. Same layers as the
          folder picker sheet (above the compose button, below dialogs). */}
      {open && isMobile && createPortal(
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'var(--overlay-scrim)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
          />
          <div
            role="dialog"
            aria-label={t('menu.tags')}
            style={{
              position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 3001, maxHeight: '70vh', overflowY: 'auto',
              background: 'var(--bg-secondary)', borderRadius: '16px 16px 0 0',
              boxShadow: '0 -4px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04)',
              paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)',
            }}
          >
            <div style={{ padding: '12px 14px 4px', fontSize: 12, fontWeight: 600 }}>{t('menu.tags')}</div>
            {list}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
