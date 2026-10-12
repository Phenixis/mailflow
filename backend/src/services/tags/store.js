// Database access for tags: definitions, per-user settings, and the stored Jev answers.
import { query } from '../db.js';
import { encrypt, decrypt } from '../encryption.js';
import { DEFAULT_TAGS, DEFAULT_SETTINGS } from './defaults.js';

const DEF_COLUMNS = `id, key, name, color, role, instructions, true_what, true_examples, false_what,
  false_examples, threshold_low, threshold_high, position, enabled`;

// Seed private/important/urgent the first time a user touches tags. Idempotent.
export async function ensureDefaultTags(userId) {
  const { rows } = await query('SELECT 1 FROM tag_definitions WHERE user_id = $1 LIMIT 1', [userId]);
  if (rows.length) return;
  for (const [position, t] of DEFAULT_TAGS.entries()) {
    await query(
      `INSERT INTO tag_definitions
         (user_id, key, name, color, role, instructions, true_what, true_examples, false_what, false_examples, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11)
       ON CONFLICT (user_id, key) DO NOTHING`,
      [userId, t.key, t.name, t.color, t.role, t.instructions, t.true_what, JSON.stringify(t.true_examples),
        t.false_what, JSON.stringify(t.false_examples), position]
    );
  }
}

export async function listDefinitions(userId) {
  await ensureDefaultTags(userId);
  const { rows } = await query(
    `SELECT ${DEF_COLUMNS} FROM tag_definitions WHERE user_id = $1 ORDER BY position, created_at`,
    [userId]
  );
  return rows;
}

const EDITABLE = {
  name: 'name', color: 'color', instructions: 'instructions', true_what: 'true_what',
  true_examples: 'true_examples', false_what: 'false_what', false_examples: 'false_examples',
  threshold_low: 'threshold_low', threshold_high: 'threshold_high', position: 'position', enabled: 'enabled',
};
const JSON_FIELDS = new Set(['true_examples', 'false_examples']);

export async function updateDefinition(userId, id, patch) {
  const sets = [];
  const params = [userId, id];
  for (const [field, column] of Object.entries(EDITABLE)) {
    if (!(field in patch)) continue;
    params.push(JSON_FIELDS.has(field) ? JSON.stringify(patch[field]) : patch[field]);
    sets.push(`${column} = $${params.length}${JSON_FIELDS.has(field) ? '::jsonb' : ''}`);
  }
  if (!sets.length) return null;
  const { rows } = await query(
    `UPDATE tag_definitions SET ${sets.join(', ')}, updated_at = NOW()
      WHERE user_id = $1 AND id = $2 RETURNING ${DEF_COLUMNS}`,
    params
  );
  return rows[0] || null;
}

export async function createDefinition(userId, d) {
  const { rows } = await query(
    `INSERT INTO tag_definitions
       (user_id, key, name, color, role, instructions, true_what, true_examples, false_what, false_examples,
        threshold_low, threshold_high, position)
     VALUES ($1,$2,$3,$4,'tag',$5,$6,$7::jsonb,$8,$9::jsonb,$10,$11,
        COALESCE((SELECT MAX(position) + 1 FROM tag_definitions WHERE user_id = $1), 0))
     RETURNING ${DEF_COLUMNS}`,
    [userId, d.key, d.name, d.color, d.instructions, d.true_what ?? null, JSON.stringify(d.true_examples ?? []),
      d.false_what ?? null, JSON.stringify(d.false_examples ?? []), d.threshold_low ?? null, d.threshold_high ?? null]
  );
  return rows[0];
}

// The privacy gate cannot be deleted: without it no body could ever be sent safely.
export async function deleteDefinition(userId, id) {
  const { rowCount } = await query(
    `DELETE FROM tag_definitions WHERE user_id = $1 AND id = $2 AND role <> 'privacy'`,
    [userId, id]
  );
  return rowCount > 0;
}

// ── settings ──────────────────────────────────────────────────────────────────

// Settings with the API key decrypted for server-side use only; routes expose just `hasApiKey`.
export async function loadSettings(userId) {
  const { rows } = await query(
    `SELECT api_key_enc, threshold_low, threshold_high, private_above, max_body_chars, model
       FROM tag_settings WHERE user_id = $1`,
    [userId]
  );
  const row = rows[0];
  const apiKey = (row?.api_key_enc ? decrypt(row.api_key_enc) : null) || process.env.TYPESAFE_API_KEY || null;
  return {
    ...DEFAULT_SETTINGS,
    ...(row ? {
      threshold_low: Number(row.threshold_low), threshold_high: Number(row.threshold_high),
      private_above: Number(row.private_above), max_body_chars: row.max_body_chars, model: row.model,
    } : {}),
    apiKey,
    apiKeySource: row?.api_key_enc ? 'ui' : (process.env.TYPESAFE_API_KEY ? 'env' : null),
  };
}

// `patch.apiKey`: a string sets it, '' or null clears it, undefined leaves it alone.
export async function saveSettings(userId, patch) {
  await query('INSERT INTO tag_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [userId]);
  const sets = [];
  const params = [userId];
  const add = (column, value) => { params.push(value); sets.push(`${column} = $${params.length}`); };
  if (patch.apiKey !== undefined) add('api_key_enc', patch.apiKey ? encrypt(patch.apiKey) : null);
  for (const column of ['threshold_low', 'threshold_high', 'private_above', 'max_body_chars', 'model']) {
    if (patch[column] !== undefined) add(column, patch[column]);
  }
  if (sets.length) await query(`UPDATE tag_settings SET ${sets.join(', ')}, updated_at = NOW() WHERE user_id = $1`, params);
}

// ── messages ──────────────────────────────────────────────────────────────────

// The message, only if the user owns its account. Includes the owning user for the queue.
export async function loadOwnedMessageForTags(userId, messageId) {
  const { rows } = await query(
    `SELECT m.id, m.account_id, m.folder, m.subject, m.from_name, m.from_email, m.snippet, m.body_text
       FROM messages m JOIN email_accounts a ON a.id = m.account_id
      WHERE m.id = $1 AND a.user_id = $2`,
    [messageId, userId]
  );
  return rows[0] || null;
}

// Replace Jev's answers for a message. Rows a human set by hand are never overwritten.
export async function saveClassification(messageId, outcome, { model }) {
  for (const r of outcome.results) {
    await query(
      `INSERT INTO message_tags (message_id, tag_id, score, applied, source, pass, body_sent)
       VALUES ($1,$2,$3,$4,'jev',$5,$6)
       ON CONFLICT (message_id, tag_id) DO UPDATE SET
         score = EXCLUDED.score, applied = EXCLUDED.applied, pass = EXCLUDED.pass,
         body_sent = EXCLUDED.body_sent, created_at = NOW()
       WHERE message_tags.source = 'jev'`,
      [messageId, r.tag.id, typeof r.score === 'number' ? r.score : null, r.applied, r.pass, r.bodySent]
    );
  }
  await saveRun(messageId, {
    status: 'done', pass: outcome.pass, bodySent: outcome.bodySent, isPrivate: outcome.isPrivate,
    model, input: outcome.usage.input, output: outcome.usage.output, error: null,
  });
}

export async function saveRun(messageId, r) {
  await query(
    `INSERT INTO message_tag_runs
       (message_id, status, pass, body_sent, is_private, model, input_tokens, output_tokens, error, classified_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
     ON CONFLICT (message_id) DO UPDATE SET
       status = EXCLUDED.status, pass = EXCLUDED.pass, body_sent = EXCLUDED.body_sent,
       is_private = EXCLUDED.is_private, model = EXCLUDED.model, input_tokens = EXCLUDED.input_tokens,
       output_tokens = EXCLUDED.output_tokens, error = EXCLUDED.error, classified_at = NOW()`,
    [messageId, r.status, r.pass ?? 1, r.bodySent ?? false, r.isPrivate ?? false, r.model ?? null,
      r.input ?? null, r.output ?? null, r.error ?? null]
  );
}

// Applied tags (and optionally every answer) for a batch of messages the user owns.
export async function tagsForMessages(userId, messageIds, { all = false } = {}) {
  if (!messageIds.length) return {};
  const { rows } = await query(
    `SELECT mt.message_id, mt.tag_id, d.key, d.name, d.color, d.role, mt.score, mt.applied, mt.source,
            mt.pass, mt.body_sent
       FROM message_tags mt
       JOIN tag_definitions d ON d.id = mt.tag_id
       JOIN messages m ON m.id = mt.message_id
       JOIN email_accounts a ON a.id = m.account_id
      WHERE mt.message_id = ANY($1::uuid[]) AND a.user_id = $2 AND d.user_id = $2
        ${all ? '' : 'AND mt.applied'}
      ORDER BY d.position`,
    [messageIds, userId]
  );
  const out = {};
  for (const r of rows) {
    (out[r.message_id] ||= []).push({
      tagId: r.tag_id, key: r.key, name: r.name, color: r.color, role: r.role,
      score: r.score === null ? null : Number(r.score), applied: r.applied, source: r.source,
      pass: r.pass, bodySent: r.body_sent,
    });
  }
  return out;
}

export async function runForMessage(userId, messageId) {
  const { rows } = await query(
    `SELECT r.status, r.pass, r.body_sent, r.is_private, r.model, r.input_tokens, r.output_tokens, r.error, r.classified_at
       FROM message_tag_runs r JOIN messages m ON m.id = r.message_id JOIN email_accounts a ON a.id = m.account_id
      WHERE r.message_id = $1 AND a.user_id = $2`,
    [messageId, userId]
  );
  return rows[0] || null;
}

// Manual override: pin a tag on or off for one message (score kept for context).
export async function setManualTag(userId, messageId, tagId, applied) {
  const { rowCount } = await query(
    `INSERT INTO message_tags (message_id, tag_id, applied, source)
     SELECT m.id, d.id, $4, 'manual'
       FROM messages m
       JOIN email_accounts a ON a.id = m.account_id
       JOIN tag_definitions d ON d.user_id = a.user_id
      WHERE m.id = $1 AND d.id = $2 AND a.user_id = $3
     ON CONFLICT (message_id, tag_id) DO UPDATE SET applied = EXCLUDED.applied, source = 'manual'`,
    [messageId, tagId, userId, applied]
  );
  return rowCount > 0;
}

// INBOX messages of the user's enabled accounts that have never been classified, newest first.
export async function unclassifiedInboxMessageIds(userId, accountIds, limit) {
  if (!accountIds.length) return [];
  const { rows } = await query(
    `SELECT m.id FROM messages m
      WHERE m.account_id = ANY($1::uuid[]) AND m.folder = 'INBOX' AND m.is_deleted = false
        AND NOT EXISTS (SELECT 1 FROM message_tag_runs r WHERE r.message_id = m.id)
      ORDER BY m.date DESC NULLS LAST LIMIT $2`,
    [accountIds, limit]
  );
  return rows.map((r) => r.id);
}
