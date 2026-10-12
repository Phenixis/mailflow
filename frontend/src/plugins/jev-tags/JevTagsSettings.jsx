import { useEffect, useState, useCallback } from 'react';
import { api } from '../../utils/api.js';
import { clearTagCache } from './tagStore.js';
import { useT } from './strings.js';

const card = { border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', background: 'var(--bg-secondary)', marginTop: 12 };
const label = { fontSize: 11, color: 'var(--text-tertiary)', display: 'block', margin: '8px 0 3px' };
const input = { width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '5px 7px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-primary, transparent)', color: 'var(--text-primary)' };
const btn = { fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer', background: 'transparent', color: 'var(--text-primary)' };
const lines = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean);

function Message({ msg }) {
  if (!msg) return null;
  return <div style={{ fontSize: 12, marginTop: 6, color: msg.type === 'error' ? 'var(--red, #ef4444)' : 'var(--text-secondary)' }}>{msg.text}</div>;
}

function ApiAndThresholds() {
  const t = useT();
  const [s, setS] = useState(null);
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState(null);
  useEffect(() => { api.tagSettings().then(setS).catch((e) => setMsg({ type: 'error', text: e.message })); }, []);
  if (!s) return <Message msg={msg} />;

  const save = async (patch, okText) => {
    try { setS(await api.tagSaveSettings(patch)); setKey(''); setMsg({ type: 'ok', text: okText }); } catch (e) { setMsg({ type: 'error', text: e.message }); }
  };
  const num = (field, textKey, step = 0.05) => (
    <div style={{ flex: 1, minWidth: 110 }}>
      <span style={label}>{t(textKey)}</span>
      <input type="number" step={step} min="0" value={s[field]} style={input}
        onChange={(e) => setS({ ...s, [field]: e.target.value === '' ? '' : Number(e.target.value) })} />
    </div>
  );

  return (
    <div style={card}>
      <div style={{ fontWeight: 600, fontSize: 13 }}>{t('conn.title')}</div>
      <span style={label}>
        {t('conn.keyLabel')} ({s.hasApiKey ? t(s.apiKeySource === 'env' ? 'conn.keyEnv' : 'conn.keySet') : t('conn.keyUnset')})
      </span>
      <div style={{ display: 'flex', gap: 6 }}>
        <input type="password" autoComplete="off" value={key} placeholder={s.hasApiKey ? t('conn.keyPlaceholderSet') : 'apikey_...'} style={input} onChange={(e) => setKey(e.target.value)} />
        <button style={btn} disabled={!key} onClick={() => save({ apiKey: key }, t('conn.saved'))}>{t('conn.save')}</button>
        {s.apiKeySource === 'ui' && <button style={btn} onClick={() => save({ apiKey: '' }, t('conn.removed'))}>{t('conn.remove')}</button>}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
        {num('threshold_low', 'conn.low')}
        {num('threshold_high', 'conn.high')}
        {num('private_above', 'conn.private')}
        {num('max_body_chars', 'conn.body', 50)}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6 }}>
        {t('conn.privacyNote')}
      </div>
      <button style={{ ...btn, marginTop: 8 }} onClick={() => save({ threshold_low: s.threshold_low, threshold_high: s.threshold_high, private_above: s.private_above, max_body_chars: s.max_body_chars }, t('conn.settingsSaved'))}>{t('conn.saveSettings')}</button>
      <Message msg={msg} />
    </div>
  );
}

function Accounts() {
  const t = useT();
  const [accounts, setAccounts] = useState(null);
  const [msg, setMsg] = useState(null);
  useEffect(() => { api.tagAccounts().then(setAccounts).catch((e) => setMsg({ type: 'error', text: e.message })); }, []);
  const toggle = async (a) => {
    try {
      await api.tagSetAccount(a.id, !a.enabled);
      setAccounts((list) => list.map((x) => (x.id === a.id ? { ...x, enabled: !a.enabled } : x)));
    } catch (e) { setMsg({ type: 'error', text: e.message }); }
  };
  const backfill = async (force) => {
    try { const r = await api.tagBackfill(100, force); setMsg({ type: 'ok', text: t('acc.queued', { n: r.queued, a: r.accounts }) }); } catch (e) { setMsg({ type: 'error', text: e.message }); }
  };
  return (
    <div style={card}>
      <div style={{ fontWeight: 600, fontSize: 13 }}>{t('acc.title')}</div>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', margin: '4px 0 6px' }}>{t('acc.note')}</div>
      {(accounts || []).map((a) => (
        <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '3px 0' }}>
          <input type="checkbox" checked={a.enabled} onChange={() => toggle(a)} /> {a.email}
        </label>
      ))}
      <button style={{ ...btn, marginTop: 8 }} onClick={() => backfill(false)}>{t('acc.backfill')}</button>
      <button style={{ ...btn, marginTop: 8, marginLeft: 8 }} onClick={() => backfill(true)}>{t('acc.reclassify')}</button>
      <Message msg={msg} />
    </div>
  );
}

function TagEditor({ def, onChanged }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(null);
  const [msg, setMsg] = useState(null);
  const start = () => {
    setF({
      name: def.name, color: def.color, instructions: def.instructions,
      true_what: def.true_what || '', true_examples: def.true_examples.join('\n'),
      false_what: def.false_what || '', false_examples: def.false_examples.join('\n'),
    });
    setOpen(true);
  };
  const patch = async (p) => { try { await api.tagUpdate(def.id, p); clearTagCache(); onChanged(); return true; } catch (e) { setMsg({ type: 'error', text: e.message }); return false; } };
  const save = async () => {
    const ok = await patch({
      name: f.name, color: f.color, instructions: f.instructions,
      true_what: f.true_what || null, true_examples: lines(f.true_examples),
      false_what: f.false_what || null, false_examples: lines(f.false_examples),
    });
    if (ok) setOpen(false);
  };
  const remove = async () => {
    if (!window.confirm(t('tags.confirmDelete', { name: def.name }))) return;
    try { await api.tagDelete(def.id); clearTagCache(); onChanged(); } catch (e) { setMsg({ type: 'error', text: e.message }); }
  };
  const field = (k, textKey, multiline) => (
    <>
      <span style={label}>{t(textKey)}</span>
      {multiline
        ? <textarea rows={k.endsWith('examples') ? 4 : 3} value={f[k]} style={input} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
        : <input value={f[k]} style={input} onChange={(e) => setF({ ...f, [k]: e.target.value })} />}
    </>
  );
  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: '8px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 12, height: 12, borderRadius: 3, background: def.color }} />
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, opacity: def.enabled ? 1 : 0.5 }}>
          {def.name}{def.role === 'privacy' ? t('tags.privacyGate') : ''}
        </span>
        <label style={{ fontSize: 11, display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={def.enabled} onChange={() => patch({ enabled: !def.enabled })} /> {t('tags.on')}
        </label>
        <button style={btn} onClick={() => (open ? setOpen(false) : start())}>{open ? t('tags.close') : t('tags.edit')}</button>
      </div>
      {open && f && (
        <div>
          {field('name', 'tags.name')}
          <span style={label}>{t('tags.color')}</span>
          <input type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} />
          {field('instructions', 'tags.question', true)}
          {field('true_what', 'tags.yesMeans')}
          {field('true_examples', 'tags.yesExamples', true)}
          {field('false_what', 'tags.noMeans')}
          {field('false_examples', 'tags.noExamples', true)}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button style={btn} onClick={save}>{t('tags.save')}</button>
            {def.role !== 'privacy' && <button style={{ ...btn, color: 'var(--red, #ef4444)' }} onClick={remove}>{t('tags.delete')}</button>}
          </div>
        </div>
      )}
      <Message msg={msg} />
    </div>
  );
}

function NewTag({ onCreated }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ key: '', name: '', color: '#3b82f6', instructions: '' });
  const [msg, setMsg] = useState(null);
  const create = async () => {
    try {
      await api.tagCreate({ ...f, key: f.key.trim().toLowerCase() });
      setF({ key: '', name: '', color: '#3b82f6', instructions: '' }); setOpen(false); setMsg(null); onCreated();
    } catch (e) { setMsg({ type: 'error', text: e.message }); }
  };
  if (!open) return <button style={{ ...btn, marginTop: 8 }} onClick={() => setOpen(true)}>{t('tags.add')}</button>;
  return (
    <div style={{ marginTop: 8 }}>
      <span style={label}>{t('tags.key')}</span>
      <input style={input} value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} />
      <span style={label}>{t('tags.name')}</span>
      <input style={input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <span style={label}>{t('tags.color')}</span>
      <input type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} />
      <span style={label}>{t('tags.newQuestion')}</span>
      <textarea rows={3} style={input} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button style={btn} onClick={create}>{t('tags.create')}</button>
        <button style={btn} onClick={() => setOpen(false)}>{t('tags.cancel')}</button>
      </div>
      <Message msg={msg} />
    </div>
  );
}

function Tags() {
  const t = useT();
  const [defs, setDefs] = useState(null);
  const [msg, setMsg] = useState(null);
  const load = useCallback(() => { api.tagDefinitions().then(setDefs).catch((e) => setMsg({ type: 'error', text: e.message })); }, []);
  useEffect(load, [load]);
  return (
    <div style={card}>
      <div style={{ fontWeight: 600, fontSize: 13 }}>{t('tags.title')}</div>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', margin: '4px 0' }}>
        {t('tags.note')}
      </div>
      {(defs || []).map((d) => <TagEditor key={d.id} def={d} onChanged={load} />)}
      <NewTag onCreated={load} />
      <Message msg={msg} />
    </div>
  );
}

export default function JevTagsSettings() {
  const t = useT();
  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ fontWeight: 700, fontSize: 15 }}>{t('settings.title')}</div>
      <ApiAndThresholds />
      <Accounts />
      <Tags />
    </div>
  );
}
