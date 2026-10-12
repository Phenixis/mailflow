// Tags API: a user's tag definitions, the tags on messages, and setting a tag by hand.
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { imapManager } from '../index.js';
import {
  KEY_RE, listDefinitions, createDefinition, updateDefinition, deleteDefinition, tagsForMessages, setManualTag, setManualTags,
} from '../services/tags/store.js';

const router = Router();
router.use(requireAuth);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const bad = (res, error) => res.status(400).json({ error });

// Returns an error string, or null when `body` is a valid (partial) definition.
function validateDefinition(body, { partial }) {
  if ('name' in body ? !(typeof body.name === 'string' && body.name.trim() && body.name.length <= 80) : !partial) return 'name is invalid';
  if ('key' in body ? !KEY_RE.test(body.key ?? '') : !partial) return 'key must be lowercase letters, digits or _ and start with a letter';
  if ('color' in body && !COLOR.test(body.color)) return 'color must be #rrggbb';
  if ('enabled' in body && typeof body.enabled !== 'boolean') return 'enabled must be a boolean';
  if ('position' in body && !Number.isInteger(body.position)) return 'position must be an integer';
  return null;
}

router.get('/definitions', async (req, res) => {
  res.json(await listDefinitions(req.session.userId));
});

router.post('/definitions', async (req, res) => {
  const err = validateDefinition(req.body ?? {}, { partial: false });
  if (err) return bad(res, err);
  const existing = await listDefinitions(req.session.userId);
  if (existing.some((d) => d.key === req.body.key)) return res.status(409).json({ error: 'A tag with this key already exists' });
  const { key, name, color } = req.body;
  res.status(201).json(await createDefinition(req.session.userId, { key, name, color }));
});

router.patch('/definitions/:id', async (req, res) => {
  if (!UUID.test(req.params.id)) return bad(res, 'Invalid id');
  const body = { ...(req.body ?? {}) };
  delete body.key; // the key is the tag's identity; rename through `name`
  const err = validateDefinition(body, { partial: true });
  if (err) return bad(res, err);
  const updated = await updateDefinition(req.session.userId, req.params.id, body);
  if (!updated) return res.status(404).json({ error: 'Tag not found' });
  res.json(updated);
});

router.delete('/definitions/:id', async (req, res) => {
  if (!UUID.test(req.params.id)) return bad(res, 'Invalid id');
  if (!(await deleteDefinition(req.session.userId, req.params.id))) return res.status(404).json({ error: 'Tag not found' });
  res.json({ ok: true });
});

// Tags on a batch of messages (up to 200), as { messageId: [tag, ...] }.
router.get('/messages', async (req, res) => {
  const ids = String(req.query.ids || '').split(',').filter(Boolean);
  if (ids.length > 200 || ids.some((id) => !UUID.test(id))) return bad(res, 'ids must be up to 200 message ids');
  res.json(await tagsForMessages(req.session.userId, ids));
});

// Add or remove one tag on several messages at once (up to 200), by hand.
router.post('/messages/bulk', async (req, res) => {
  const { messageIds, tagId, applied } = req.body ?? {};
  if (!Array.isArray(messageIds) || !messageIds.length || messageIds.length > 200 || messageIds.some((id) => !UUID.test(id))) {
    return bad(res, 'messageIds must be 1 to 200 message ids');
  }
  if (!UUID.test(tagId ?? '')) return bad(res, 'Invalid tagId');
  if (typeof applied !== 'boolean') return bad(res, 'applied (boolean) is required');
  const changed = await setManualTags(req.session.userId, messageIds, tagId, applied);
  if (!changed.length) return res.status(404).json({ error: 'No message or tag found' });
  imapManager.broadcast({ type: 'tags_updated', messageIds: changed }, req.session.userId);
  res.json({ updated: changed.length });
});

// Add (applied: true) or remove (applied: false) a tag on one message, by hand.
router.put('/messages/:id/tags/:tagId', async (req, res) => {
  if (!UUID.test(req.params.id) || !UUID.test(req.params.tagId)) return bad(res, 'Invalid id');
  if (typeof req.body?.applied !== 'boolean') return bad(res, 'applied (boolean) is required');
  if (!(await setManualTag(req.session.userId, req.params.id, req.params.tagId, req.body.applied))) {
    return res.status(404).json({ error: 'Message or tag not found' });
  }
  imapManager.broadcast({ type: 'tags_updated', messageIds: [req.params.id] }, req.session.userId);
  res.json({ ok: true });
});

export default router;
