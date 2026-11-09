// Jev tags API, mounted at /api/jev-tags: connection settings, the question Jev answers for each tag,
// per-account opt-in, the stored answers behind a message's tags, reclassification and backfill.
import { Router } from 'express';
import {
  requireAuth, listUserAccounts, getAccountConfig, setAccountConfig, loadOwnedMessage, getMessageAnnotations,
  listTagDefinitions, listInboxMessageIds,
} from '../api.js';
import { PLUGIN_ID } from './defaults.js';
import { loadSettings, saveSettings, loadQuestions, saveQuestion, removeQuestion, ensureDefaults, defaultInstructions } from './config.js';
import { jevQueue } from './queue.js';

const router = Router();
router.use(requireAuth);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const bad = (res, error) => res.status(400).json({ error });
const isProb = (v) => typeof v === 'number' && v >= 0 && v <= 1;
const validExamples = (list) => Array.isArray(list) && list.length <= 20 && list.every((e) => typeof e === 'string' && e.trim() && e.length <= 200);

// ── settings ──────────────────────────────────────────────────────────────────
const publicSettings = (s) => ({
  hasApiKey: Boolean(s.apiKey), apiKeySource: s.apiKeySource,
  threshold_low: s.threshold_low, threshold_high: s.threshold_high, private_above: s.private_above,
  max_body_chars: s.max_body_chars, model: s.model, privacyTagKey: s.privacyTagKey,
});

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
  if ('privacyTagKey' in b && !KEY.test(b.privacyTagKey ?? '')) return bad(res, 'privacyTagKey is invalid');
  if ('apiKey' in b && b.apiKey !== null && (typeof b.apiKey !== 'string' || b.apiKey.length > 300)) return bad(res, 'apiKey is invalid');
  const current = await loadSettings(req.session.userId);
  if ((b.threshold_low ?? current.threshold_low) >= (b.threshold_high ?? current.threshold_high)) {
    return bad(res, 'threshold_low must be below threshold_high');
  }
  await saveSettings(req.session.userId, b);
  res.json(publicSettings(await loadSettings(req.session.userId)));
});

// ── questions (one per tag) ───────────────────────────────────────────────────
// Every tag the user has, with the question Jev answers for it (null = not classified by Jev).
router.get('/questions', async (req, res) => {
  const [defs, questions] = await Promise.all([listTagDefinitions(req.session.userId), loadQuestions(req.session.userId)]);
  res.json(defs.map((d) => ({
    key: d.key, name: d.name, color: d.color, tagEnabled: d.enabled, question: questions[d.key] ?? null,
    defaultInstructions: defaultInstructions(d.name),
  })));
});

function validateQuestion(b) {
  if ('instructions' in b && (typeof b.instructions !== 'string' || b.instructions.length > 2000)) return 'instructions must be text of up to 2000 characters';
  for (const f of ['true_what', 'false_what']) {
    if (f in b && b[f] !== null && (typeof b[f] !== 'string' || b[f].length > 500)) return `${f} is invalid`;
  }
  for (const f of ['true_examples', 'false_examples']) {
    if (f in b && !validExamples(b[f])) return `${f} must be up to 20 short strings`;
  }
  for (const f of ['threshold_low', 'threshold_high']) {
    if (f in b && b[f] !== null && !isProb(b[f])) return `${f} must be between 0 and 1`;
  }
  for (const f of ['enabled', 'learn']) {
    if (f in b && typeof b[f] !== 'boolean') return `${f} must be a boolean`;
  }
  return null;
}

router.put('/questions/:key', async (req, res) => {
  if (!KEY.test(req.params.key)) return bad(res, 'Invalid key');
  const b = req.body ?? {};
  const err = validateQuestion(b);
  if (err) return bad(res, err);
  const defs = await listTagDefinitions(req.session.userId);
  if (!defs.some((d) => d.key === req.params.key)) return res.status(404).json({ error: 'Tag not found' });
  const question = {
    instructions: (b.instructions ?? '').trim(), // empty = the default question built from the tag's name
    true_what: b.true_what ?? null, true_examples: b.true_examples ?? [],
    false_what: b.false_what ?? null, false_examples: b.false_examples ?? [],
    threshold_low: b.threshold_low ?? null, threshold_high: b.threshold_high ?? null,
    enabled: b.enabled ?? true,
    learn: b.learn ?? true, // also use the mail the user tagged by hand as examples
  };
  await saveQuestion(req.session.userId, req.params.key, question);
  res.json({ key: req.params.key, question });
});

router.delete('/questions/:key', async (req, res) => {
  if (!KEY.test(req.params.key)) return bad(res, 'Invalid key');
  await removeQuestion(req.session.userId, req.params.key);
  res.json({ ok: true });
});

// Create Private / Important / Urgent (when missing) with their default questions.
router.post('/defaults', async (req, res) => {
  await ensureDefaults(req.session.userId);
  res.json({ ok: true });
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
// Why a message has (or does not have) its tags: every answer Jev gave, and how the run went.
router.get('/messages/:id', async (req, res) => {
  if (!UUID.test(req.params.id)) return bad(res, 'Invalid id');
  const message = await loadOwnedMessage(req.session.userId, req.params.id);
  if (!message) return res.status(404).json({ error: 'Message not found' });
  const annotation = (await getMessageAnnotations(message.account_id, [message.id], PLUGIN_ID))[message.id] ?? {};
  const defs = await listTagDefinitions(req.session.userId);
  const answers = defs
    .filter((d) => annotation.answers?.[d.key])
    .map((d) => ({ key: d.key, name: d.name, color: d.color, ...annotation.answers[d.key] }));
  res.json({ answers, run: annotation.run ?? null });
});

router.post('/messages/:id/classify', async (req, res) => {
  if (!UUID.test(req.params.id)) return bad(res, 'Invalid id');
  if (!(await loadOwnedMessage(req.session.userId, req.params.id))) return res.status(404).json({ error: 'Message not found' });
  if (!(await loadSettings(req.session.userId)).apiKey) return bad(res, 'No Jev API key configured');
  jevQueue.enqueue(req.session.userId, [req.params.id]);
  res.status(202).json({ queued: 1 });
});

// Classify existing INBOX mail, newest first: by default only mail Jev has not seen or failed on; with `force: true`
// also mail already classified (a tag the user set or removed by hand is never overridden).
router.post('/backfill', async (req, res) => {
  const limit = req.body?.limit ?? 100;
  if (!(Number.isInteger(limit) && limit >= 1 && limit <= 500)) return bad(res, 'limit must be an integer from 1 to 500');
  if ('force' in (req.body ?? {}) && typeof req.body.force !== 'boolean') return bad(res, 'force must be a boolean');
  if (!(await loadSettings(req.session.userId)).apiKey) return bad(res, 'No Jev API key configured');
  const accounts = await listUserAccounts(req.session.userId);
  const enabled = [];
  for (const a of accounts) if ((await getAccountConfig(PLUGIN_ID, a.id)).enabled) enabled.push(a.id);
  const ids = await listInboxMessageIds(req.session.userId, enabled, limit, req.body?.force === true ? {} : { withoutAnnotation: PLUGIN_ID, retryStatuses: ['error'] });
  res.status(202).json({ queued: jevQueue.enqueue(req.session.userId, ids), accounts: enabled.length });
});

export default router;
