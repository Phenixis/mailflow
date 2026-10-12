import { useEffect, useState, useCallback } from 'react';
import { api } from '../../utils/api.js';
import { useTranslation } from 'react-i18next';

const card = { border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', background: 'var(--bg-secondary)', marginTop: 12 };
const label = { fontSize: 11, color: 'var(--text-tertiary)', display: 'block', margin: '8px 0 3px' };
const input = { width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '5px 7px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-primary, transparent)', color: 'var(--text-primary)' };
const btn = { fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer', background: 'transparent', color: 'var(--text-primary)' };
const lines = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean);

function Message({ msg }) {
  if (!msg) return null;
  return <div style={{ fontSize: 12, marginTop: 6, color: msg.type === 'error' ? 'var(--red, #ef4444)' : 'var(--text-secondary)' }}>{msg.text}</div>;
}

function Connection({ tags }) {
  const { t } = useTranslation();
  const [s, setS] = useState(null);
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState(null);
  useEffect(() => { api.jevSettings().then(setS).catch((e) => setMsg({ type: 'error', text: e.message })); }, []);
  if (!s) return <Message msg={msg} />;

  const save = async (patch, okText) => {
    try { setS(await api.jevSaveSettings(patch)); setKey(''); setMsg({ type: 'ok', text: okText }); } catch (e) { setMsg({ type: 'error', text: e.message }); }
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
      <div style={{ fontWeight: 600, fontSize: 13 }}>{t('jevTags.conn.title')}</div>
      <span style={label}>
        {t('jevTags.conn.keyLabel')} ({s.hasApiKey ? t(s.apiKeySource === 'env' ? 'jevTags.conn.keyEnv' : 'jevTags.conn.keySet') : t('jevTags.conn.keyUnset')})
      </span>
      <div style={{ display: 'flex', gap: 6 }}>
        <input type="password" autoComplete="off" value={key} placeholder={s.hasApiKey ? t('jevTags.conn.keyPlaceholderSet') : 'apikey_...'} style={input} onChange={(e) => setKey(e.target.value)} />
        <button style={btn} disabled={!key} onClick={() => save({ apiKey: key.trim() }, t('jevTags.conn.saved'))}>{t('common.save')}</button>
        {s.apiKeySource === 'ui' && <button style={btn} onClick={() => save({ apiKey: '' }, t('jevTags.conn.removed'))}>{t('common.remove')}</button>}
      </div>
      {key && !key.trim().startsWith('apikey_') && <div style={{ fontSize: 11, color: 'var(--red, #ef4444)', marginTop: 4 }}>{t('jevTags.conn.keyFormatHint')}</div>}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
        {num('threshold_low', 'jevTags.conn.low')}
        {num('threshold_high', 'jevTags.conn.high')}
        {num('private_above', 'jevTags.conn.private')}
        {num('max_body_chars', 'jevTags.conn.body', 50)}
      </div>
      <span style={label}>{t('jevTags.conn.gate')}</span>
      <select value={s.privacyTagKey} style={input} onChange={(e) => setS({ ...s, privacyTagKey: e.target.value })}>
        {!tags.some((x) => x.key === s.privacyTagKey) && <option value={s.privacyTagKey}>{s.privacyTagKey}</option>}
        {tags.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
      </select>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6 }}>{t('jevTags.conn.privacyNote')}</div>
      <button
        style={{ ...btn, marginTop: 8 }}
        onClick={() => save({ threshold_low: s.threshold_low, threshold_high: s.threshold_high, private_above: s.private_above, max_body_chars: s.max_body_chars, privacyTagKey: s.privacyTagKey }, t('jevTags.conn.settingsSaved'))}
      >
        {t('jevTags.conn.saveSettings')}
      </button>
      <Message msg={msg} />
    </div>
  );
}

function Accounts() {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState(null);
  const [msg, setMsg] = useState(null);
  useEffect(() => { api.jevAccounts().then(setAccounts).catch((e) => setMsg({ type: 'error', text: e.message })); }, []);
  const toggle = async (a) => {
    try {
      await api.jevSetAccount(a.id, !a.enabled);
      setAccounts((list) => list.map((x) => (x.id === a.id ? { ...x, enabled: !a.enabled } : x)));
    } catch (e) { setMsg({ type: 'error', text: e.message }); }
  };
  const backfill = async (force) => {
    try { const r = await api.jevBackfill(100, force); setMsg({ type: 'ok', text: t('jevTags.acc.queued', { n: r.queued, a: r.accounts }) }); } catch (e) { setMsg({ type: 'error', text: e.message }); }
  };
  return (
    <div style={card}>
      <div style={{ fontWeight: 600, fontSize: 13 }}>{t('jevTags.acc.title')}</div>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', margin: '4px 0 6px' }}>{t('jevTags.acc.note')}</div>
      {(accounts || []).map((a) => (
        <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '3px 0' }}>
          <input type="checkbox" checked={a.enabled} onChange={() => toggle(a)} /> {a.email}
        </label>
      ))}
      <button style={{ ...btn, marginTop: 8 }} onClick={() => backfill(false)}>{t('jevTags.acc.backfill')}</button>
      <button style={{ ...btn, marginTop: 8, marginLeft: 8 }} onClick={() => backfill(true)}>{t('jevTags.acc.reclassify')}</button>
      <Message msg={msg} />
    </div>
  );
}

function QuestionEditor({ item, onChanged }) {
  const { t } = useTranslation();
  const q = item.question;
  const on = Boolean(q) && q.enabled !== false;
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(null);
  const [msg, setMsg] = useState(null);
  const start = () => {
    setF({
      instructions: q?.instructions || '', true_what: q?.true_what || '', true_examples: (q?.true_examples || []).join('\n'),
      false_what: q?.false_what || '', false_examples: (q?.false_examples || []).join('\n'), learn: q ? q.learn !== false : true,
    });
    setOpen(true);
  };
  const send = async (body) => {
    try { await api.jevSaveQuestion(item.key, body); setMsg(null); onChanged(); return true; } catch (e) { setMsg({ type: 'error', text: e.message }); return false; }
  };
  // The row switch: turn Jev on or off for this tag without opening the editor.
  const toggle = () => send(q ? { ...q, enabled: !on } : { instructions: '', enabled: true });
  const save = async () => {
    if (await send({
      instructions: f.instructions, true_what: f.true_what || null, true_examples: lines(f.true_examples),
      false_what: f.false_what || null, false_examples: lines(f.false_examples), learn: f.learn, enabled: on || !q,
    })) { setMsg({ type: 'ok', text: t('jevTags.q.saved') }); setOpen(false); }
  };
  const remove = async () => { try { await api.jevDeleteQuestion(item.key); setOpen(false); onChanged(); } catch (e) { setMsg({ type: 'error', text: e.message }); } };
  const field = (k, textKey, multiline, placeholder) => (
    <>
      <span style={label}>{t(textKey)}</span>
      {multiline
        ? <textarea rows={k.endsWith('examples') ? 4 : 3} value={f[k]} placeholder={placeholder} style={input} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
        : <input value={f[k]} style={input} onChange={(e) => setF({ ...f, [k]: e.target.value })} />}
    </>
  );
  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: '8px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 12, height: 12, borderRadius: 3, background: item.color }} />
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, opacity: on ? 1 : 0.6 }}>
          {item.name}{!on && <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--text-tertiary)' }}> - {t('jevTags.q.off')}</span>}
        </span>
        <label style={{ fontSize: 11, display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={on} onChange={toggle} /> {t('jevTags.q.toggle')}
        </label>
        <button style={btn} onClick={() => (open ? setOpen(false) : start())}>{open ? t('admin.close') : t('common.edit')}</button>
      </div>
      {open && f && (
        <div>
          {field('instructions', 'jevTags.q.question', true, item.defaultInstructions)}
          {field('true_what', 'jevTags.q.yesMeans')}
          {field('true_examples', 'jevTags.q.yesExamples', true)}
          {field('false_what', 'jevTags.q.noMeans')}
          {field('false_examples', 'jevTags.q.noExamples', true)}
          <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}>
            <input type="checkbox" checked={f.learn} onChange={() => setF({ ...f, learn: !f.learn })} /> {t('jevTags.q.learn')}
          </label>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{t('jevTags.q.learnNote')}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button style={btn} onClick={save}>{t('jevTags.q.save')}</button>
            {q && <button style={{ ...btn, color: 'var(--red, #ef4444)' }} onClick={remove}>{t('jevTags.q.remove')}</button>}
          </div>
        </div>
      )}
      <Message msg={msg} />
    </div>
  );
}

function Questions({ items, reload }) {
  const { t } = useTranslation();
  const [msg, setMsg] = useState(null);
  const defaults = async () => { try { await api.jevDefaults(); setMsg({ type: 'ok', text: t('jevTags.q.created') }); reload(); } catch (e) { setMsg({ type: 'error', text: e.message }); } };
  return (
    <div style={card}>
      <div style={{ fontWeight: 600, fontSize: 13 }}>{t('jevTags.q.title')}</div>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', margin: '4px 0' }}>{t('jevTags.q.note')}</div>
      {items.map((item) => <QuestionEditor key={item.key} item={item} onChanged={reload} />)}
      <button style={{ ...btn, marginTop: 8 }} onClick={defaults}>{t('jevTags.q.defaults')}</button>
      <Message msg={msg} />
    </div>
  );
}

export default function JevSettings() {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const reload = useCallback(() => { api.jevQuestions().then(setItems).catch(() => {}); }, []);
  useEffect(reload, [reload]);
  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ fontWeight: 700, fontSize: 15 }}>{t('jevTags.conn.title')}</div>
      <Connection tags={items} />
      <Accounts />
      <Questions items={items} reload={reload} />
    </div>
  );
}
