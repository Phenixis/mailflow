// Tags on messages: definitions, and which messages carry which tag. A tag belongs to a user; a
// message belongs to the user's account. Every read and write here is scoped to the owning user.
import { query } from '../db.js';

const DEF_COLUMNS = 'id, key, name, color, position, enabled';
export const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

export async function listDefinitions(userId) {
  const { rows } = await query(
    `SELECT ${DEF_COLUMNS} FROM tag_definitions WHERE user_id = $1 ORDER BY position, created_at`,
    [userId]
  );
  return rows;
}

export async function createDefinition(userId, { key, name, color = '#6b7280' }) {
  const { rows } = await query(
    `INSERT INTO tag_definitions (user_id, key, name, color, position)
     VALUES ($1, $2, $3, $4, COALESCE((SELECT MAX(position) + 1 FROM tag_definitions WHERE user_id = $1), 0))
     RETURNING ${DEF_COLUMNS}`,
    [userId, key, name, color]
  );
  return rows[0];
}

// Create the tag unless the user already has one with that key (a plugin seeding its defaults).
export async function ensureDefinition(userId, { key, name, color }) {
  const { rows } = await query(
    `INSERT INTO tag_definitions (user_id, key, name, color, position)
     VALUES ($1, $2, $3, $4, COALESCE((SELECT MAX(position) + 1 FROM tag_definitions WHERE user_id = $1), 0))
     ON CONFLICT (user_id, key) DO UPDATE SET key = tag_definitions.key
     RETURNING ${DEF_COLUMNS}`,
    [userId, key, name, color ?? '#6b7280']
  );
  return rows[0];
}

const EDITABLE = ['name', 'color', 'position', 'enabled'];

export async function updateDefinition(userId, id, patch) {
  const sets = [];
  const params = [userId, id];
  for (const field of EDITABLE) {
    if (!(field in patch)) continue;
    params.push(patch[field]);
    sets.push(`${field} = $${params.length}`);
  }
  if (!sets.length) return null;
  const { rows } = await query(
    `UPDATE tag_definitions SET ${sets.join(', ')}, updated_at = NOW()
      WHERE user_id = $1 AND id = $2 RETURNING ${DEF_COLUMNS}`,
    params
  );
  return rows[0] || null;
}

export async function deleteDefinition(userId, id) {
  const { rowCount } = await query('DELETE FROM tag_definitions WHERE user_id = $1 AND id = $2', [userId, id]);
  return rowCount > 0;
}

// Tags currently on each message (dismissed ones excluded), for messages the user owns.
export async function tagsForMessages(userId, messageIds) {
  if (!messageIds.length) return {};
  const { rows } = await query(
    `SELECT mt.message_id, d.id AS tag_id, d.key, d.name, d.color, mt.source
       FROM message_tags mt
       JOIN tag_definitions d ON d.id = mt.tag_id
       JOIN messages m ON m.id = mt.message_id
       JOIN email_accounts a ON a.id = m.account_id
      WHERE mt.message_id = ANY($1::uuid[]) AND a.user_id = $2 AND d.user_id = $2
        AND NOT mt.dismissed AND d.enabled
      ORDER BY d.position`,
    [messageIds, userId]
  );
  const out = {};
  for (const r of rows) {
    (out[r.message_id] ||= []).push({ tagId: r.tag_id, key: r.key, name: r.name, color: r.color, source: r.source });
  }
  return out;
}

// The user adds or removes a tag by hand on one or more messages. Removing keeps the row (dismissed)
// so an automatic source does not put it back; adding again clears that and takes ownership as
// 'manual'. Returns the ids of the messages that were the user's and got the change.
export async function setManualTags(userId, messageIds, tagId, on) {
  if (!messageIds.length) return [];
  const { rows } = await query(
    `INSERT INTO message_tags (message_id, tag_id, source, dismissed)
     SELECT m.id, d.id, 'manual', $4
       FROM messages m
       JOIN email_accounts a ON a.id = m.account_id
       JOIN tag_definitions d ON d.user_id = a.user_id
      WHERE m.id = ANY($1::uuid[]) AND d.id = $2 AND a.user_id = $3
     ON CONFLICT (message_id, tag_id) DO UPDATE SET dismissed = EXCLUDED.dismissed, source = 'manual'
     RETURNING message_id`,
    [messageIds, tagId, userId, !on]
  );
  return rows.map((r) => r.message_id);
}

export async function setManualTag(userId, messageId, tagId, on) {
  return (await setManualTags(userId, [messageId], tagId, on)).length > 0;
}

// A plugin puts a tag on a message. It never overrides the user: if the user set or removed this tag
// by hand, nothing changes. Returns 'applied', 'unchanged', or 'skipped' (user decision / unknown).
export async function applyTag(userId, messageId, tagKey, source) {
  const { rows } = await query(
    `INSERT INTO message_tags (message_id, tag_id, source)
     SELECT m.id, d.id, $4
       FROM messages m
       JOIN email_accounts a ON a.id = m.account_id
       JOIN tag_definitions d ON d.user_id = a.user_id AND d.key = $2
      WHERE m.id = $1 AND a.user_id = $3
     ON CONFLICT (message_id, tag_id) DO UPDATE SET created_at = NOW()
       WHERE message_tags.source = EXCLUDED.source
     RETURNING (xmax = 0) AS inserted`,
    [messageId, tagKey, userId, source]
  );
  if (!rows.length) return 'skipped';
  return rows[0].inserted ? 'applied' : 'unchanged';
}

// A plugin takes back a tag it applied earlier. Only rows from that source are removed.
export async function removeTag(userId, messageId, tagKey, source) {
  const { rowCount } = await query(
    `DELETE FROM message_tags mt
      USING messages m, email_accounts a, tag_definitions d
      WHERE mt.message_id = m.id AND m.id = $1 AND a.id = m.account_id AND a.user_id = $3
        AND d.id = mt.tag_id AND d.user_id = $3 AND d.key = $2
        AND mt.source = $4 AND NOT mt.dismissed`,
    [messageId, tagKey, userId, source]
  );
  return rowCount > 0;
}

// INBOX messages of the given accounts (owned by the user), newest first. `withoutAnnotation` limits
// the result to messages a plugin has not annotated yet (its "not processed" marker).
export async function listInboxMessageIds(userId, accountIds, limit, { withoutAnnotation = null } = {}) {
  if (!accountIds.length) return [];
  const params = [accountIds, userId, limit];
  let missing = '';
  if (withoutAnnotation) {
    params.push(withoutAnnotation);
    missing = `AND NOT (m.plugin_annotations ? $${params.length})`;
  }
  const { rows } = await query(
    `SELECT m.id FROM messages m JOIN email_accounts a ON a.id = m.account_id
      WHERE m.account_id = ANY($1::uuid[]) AND a.user_id = $2 AND m.folder = 'INBOX' AND m.is_deleted = false
        ${missing}
      ORDER BY m.date DESC NULLS LAST LIMIT $3`,
    params
  );
  return rows.map((r) => r.id);
}
