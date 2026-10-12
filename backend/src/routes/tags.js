// Tags API: tag definitions, Jev settings, per-account opt-in, stored answers, reclassification.
// Mounted at /api/tags by the jev-tags plugin manifest.
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { listUserAccounts } from '../services/mailAccess.js';
import { getAccountConfig, setAccountConfig } from '../plugins/accountConfig.js';
import {
  listDefinitions, createDefinition, updateDefinition, deleteDefinition, loadSettings, saveSettings,
  loadOwnedMessageForTags, tagsForMessages, runForMessage, setManualTag, unclassifiedInboxMessageIds,
} from '../services/tags/store.js';
import { tagQueue } from '../services/tags/queue.js';
import { PLUGIN_ID } from '../services/tags/defaults.js';

const router = Router();
router.use(requireAuth);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const bad = (res, error) => res.status(400).json({ error });
const isProb = (v) => typeof v === 'number' && v >= 0 && v <= 1;

function validExamples(list) {
  return Array.isArray(list) && list.length <= 20
    && list.every((e) => typeof e === 'string' && e.trim() && e.length <= 200);
}

// Returns an error string, or null when `body` is a valid (partial) definition.
function validateDefinition(body, { partial }) {
  const text = (field, max, required) => {
    if (!(field in body)) return required && !partial ? `${field} is required` : null;
    return typeof body[field] === 'string' && body[field].trim() && body[field].length <= max ? null : `${field} is invalid`;
  };
  const checks = [
    text('name', 80, true), text('instructions', 2000, true),
    'key' in body ? (KEY.test(body.key ?? '') ? null : 'key must be lowercase letters, digits or _') : (partial ? null : 'key is required'),
    'color' in body && !COLOR.test(body.color) ? 'color must be #rrggbb' : null,
    ...['true_what', 'false_what'].map((f) => (f in body && body[f] !== null && (typeof body[f] !== 'string' || body[f].length > 500) ? `${f} is invalid` : null)),
    ...['true_examples', 'false_examples'].map((f) => (f in body && !validExamples(body[f]) ? `${f} must be up to 20 short strings` : null)),
    ...['threshold_low', 'threshold_high'].map((f) => (f in body && body[f] !== null && !isProb(body[f]) ? `${f} must be between 0 and 1` : null)),
    'enabled' in body && typeof body.enabled !== 'boolean' ? 'enabled must be a boolean' : null,
    'position' in body && !Number.isInteger(body.position) ? 'position must be an integer' : null,
  ];
  return checks.find(Boolean) || null;
}

const publicDefinition = (d) => ({
  ...d,
  threshold_low: d.threshold_low === null ? null : Number(d.threshold_low),
  threshold_high: d.threshold_high === null ? null : Number(d.threshold_high),
});

// ── definitions ───────────────────────────────────────────────────────────────
router.get('/definitions', async (req, res) => {
  res.json((await listDefinitions(req.session.userId)).map(publicDefinition));
});

router.post('/definitions', async (req, res) => {
  const err = validateDefinition(req.body ?? {}, { partial: false });
  if (err) return bad(res, err);
  const existing = await listDefinitions(req.session.userId);
  if (existing.some((d) => d.key === req.body.key)) return res.status(409).json({ error: 'A tag with this key already exists' });
  const { key, name, instructions } = req.body;
  const created = await createDefinition(req.session.userId, { color: '#6b7280', ...req.body, key, name, instructions });
  res.status(201).json(publicDefinition(created));
});

router.patch('/definitions/:id', async (req, res) => {
  if (!UUID.test(req.params.id)) return bad(res, 'Invalid id');
  const body = { ...(req.body ?? {}) };
  delete body.key; // a key is the tag's identity; rename via `name`
  const err = validateDefinition(body, { partial: true });
  if (err) return bad(res, err);
  const updated = await updateDefinition(req.session.userId, req.params.id, body);
  if (!updated) return res.status(404).json({ error: 'Tag not found' });
  res.json(publicDefinition(updated));
});

router.delete('/definitions/:id', async (req, res) => {
  if (!UUID.test(req.params.id)) return bad(res, 'Invalid id');
  const removed = await deleteDefinition(req.session.userId, req.params.id);
  if (!removed) return res.status(404).json({ error: 'Tag not found, or it is the privacy tag, which cannot be deleted' });
  res.json({ ok: true });
});

// ── settings ──────────────────────────────────────────────────────────────────
function publicSettings(s) {
  return {
    hasApiKey: Boolean(s.apiKey), apiKeySource: s.apiKeySource,
    threshold_low: s.threshold_low, threshold_high: s.threshold_high, private_above: s.private_above,
    max_body_chars: s.max_body_chars, model: s.model,
  };
}

router.get('/settings', async (req, res) => {
  res.json(publicSettings(await loadSettings(req.session.userId)));
});

router.put('/settings', async (req, res) => {
  const b = req.body ?? {};
  for (const f of ['threshold_low', 'threshold_high', 'private_above']) {
    if (f in b && !isProb(b[f])) return bad(res, `${f} must be between 0 and 1`);
  }
  if ('max_body_chars' in b && !(Number.isInteger(b.max_body_chars) && b.max_body_chars >= 0 && b.max_body_chars <= 2000)) {
    return bad(res, 'max_body_chars must be an integer from 0 to 2000');
  }
  if ('model' in b && !(typeof b.model === 'string' && /^[\w.-]{1,80}$/.test(b.model))) return bad(res, 'model is invalid');
  if ('apiKey' in b && b.apiKey !== null && (typeof b.apiKey !== 'string' || b.apiKey.length > 300)) return bad(res, 'apiKey is invalid');
  const current = await loadSettings(req.session.userId);
  const low = b.threshold_low ?? current.threshold_low;
  const high = b.threshold_high ?? current.threshold_high;
  if (low >= high) return bad(res, 'threshold_low must be below threshold_high');
  await saveSettings(req.session.userId, b);
  res.json(publicSettings(await loadSettings(req.session.userId)));
});

// ── per-account opt-in (default off: nothing is sent to Jev unless the account is enabled) ──
router.get('/accounts', async (req, res) => {
  const accounts = await listUserAccounts(req.session.userId);
  const out = [];
  for (const a of accounts) {
    out.push({ id: a.id, email: a.email_address, enabled: Boolean((await getAccountConfig(PLUGIN_ID, a.id)).enabled) });
  }
  res.json(out);
});

router.put('/accounts/:id', async (req, res) => {
  if (!UUID.test(req.params.id)) return bad(res, 'Invalid id');
  if (typeof req.body?.enabled !== 'boolean') return bad(res, 'enabled (boolean) is required');
  const accounts = await listUserAccounts(req.session.userId);
  if (!accounts.some((a) => a.id === req.params.id)) return res.status(404).json({ error: 'Account not found' });
  const config = await getAccountConfig(PLUGIN_ID, req.params.id);
  await setAccountConfig(PLUGIN_ID, req.params.id, { ...config, enabled: req.body.enabled });
  res.json({ id: req.params.id, enabled: req.body.enabled });
});

// ── messages ──────────────────────────────────────────────────────────────────
router.get('/messages', async (req, res) => {
  const ids = String(req.query.ids || '').split(',').filter(Boolean);
  if (ids.length > 200 || ids.some((id) => !UUID.test(id))) return bad(res, 'ids must be up to 200 message ids');
  res.json(await tagsForMessages(req.session.userId, ids));
});

router.get('/messages/:id', async (req, res) => {
  if (!UUID.test(req.params.id)) return bad(res, 'Invalid id');
  const message = await loadOwnedMessageForTags(req.session.userId, req.params.id);
  if (!message) return res.status(404).json({ error: 'Message not found' });
  const tags = (await tagsForMessages(req.session.userId, [req.params.id], { all: true }))[req.params.id] || [];
  res.json({ tags, run: await runForMessage(req.session.userId, req.params.id) });
});

router.put('/messages/:id/tags/:tagId', async (req, res) => {
  if (!UUID.test(req.params.id) || !UUID.test(req.params.tagId)) return bad(res, 'Invalid id');
  if (typeof req.body?.applied !== 'boolean') return bad(res, 'applied (boolean) is required');
  const ok = await setManualTag(req.session.userId, req.params.id, req.params.tagId, req.body.applied);
  if (!ok) return res.status(404).json({ error: 'Message or tag not found' });
  res.json({ ok: true });
});

router.post('/messages/:id/classify', async (req, res) => {
  if (!UUID.test(req.params.id)) return bad(res, 'Invalid id');
  const message = await loadOwnedMessageForTags(req.session.userId, req.params.id);
  if (!message) return res.status(404).json({ error: 'Message not found' });
  if (!(await loadSettings(req.session.userId)).apiKey) return bad(res, 'No Jev API key configured');
  tagQueue.enqueue(req.session.userId, [req.params.id]);
  res.status(202).json({ queued: 1 });
});

// Classify existing INBOX mail that has never been through Jev (newest first).
router.post('/backfill', async (req, res) => {
  const limit = req.body?.limit ?? 100;
  if (!(Number.isInteger(limit) && limit >= 1 && limit <= 500)) return bad(res, 'limit must be an integer from 1 to 500');
  if (!(await loadSettings(req.session.userId)).apiKey) return bad(res, 'No Jev API key configured');
  const accounts = await listUserAccounts(req.session.userId);
  const enabled = [];
  for (const a of accounts) if ((await getAccountConfig(PLUGIN_ID, a.id)).enabled) enabled.push(a.id);
  const ids = await unclassifiedInboxMessageIds(req.session.userId, enabled, limit);
  res.status(202).json({ queued: tagQueue.enqueue(req.session.userId, ids), accounts: enabled.length });
});

export default router;
