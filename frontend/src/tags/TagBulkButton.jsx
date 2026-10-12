import { useState } from 'react';
import TagPickerList from './TagPickerList.jsx';
import { useMobile } from '../hooks/useMobile.js';
import { useT } from './strings.js';

// The "Tags" button of the bulk-selection toolbar. `Btn` is the toolbar's own button component, so
// it looks like its neighbours; clicking opens a small popover to add or remove tags on all `ids`.
export default function TagBulkButton({ ids, Btn }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const isMobile = useMobile();
  // A phone gets a bottom sheet (an absolute popover under a small button runs off the screen).
  const panel = isMobile
    ? { position: 'fixed', left: 8, right: 8, bottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)', maxHeight: '60vh' }
    : { position: 'absolute', top: '100%', right: 0, minWidth: 240, maxHeight: 320 };
  return (
    <div style={{ position: 'relative' }}>
      <Btn title={t('menu.tags')} onClick={() => setOpen(!open)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
          <line x1="7" y1="7" x2="7.01" y2="7" />
        </svg>
      </Btn>
      {open && (
        <>
          <div onClick={() => setOpen(false)} aria-hidden style={{ position: 'fixed', inset: 0, zIndex: 999 }} />
          <div style={{
            ...panel, zIndex: 1000, overflowY: 'auto',
            background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: 'var(--shadow-popover)',
          }}>
            <TagPickerList messageIds={ids} />
          </div>
        </>
      )}
    </div>
  );
}
