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

// Tags currently on each message (dismissed ones excluded), for messages the user owns. A tag belongs to
// the email (account + Message-ID, see tag_email_key), so it shows on every row of that email.
export async function tagsForMessages(userId, messageIds) {
  if (!messageIds.length) return {};
  const { rows } = await query(
    `SELECT m.id AS message_id, d.id AS tag_id, d.key, d.name, d.color, mt.source
       FROM messages m
       JOIN email_accounts a ON a.id = m.account_id
       JOIN message_tags mt ON mt.account_id = m.account_id AND mt.email_key = tag_email_key(m.message_id, m.id)
       JOIN tag_definitions d ON d.id = mt.tag_id
      WHERE m.id = ANY($1::uuid[]) AND a.user_id = $2 AND d.user_id = $2
        AND NOT mt.dismissed AND d.enabled
      ORDER BY d.position`,
    [messageIds, userId]
  );
  const out = {};
  for (const r of rows) {
    (out[r.message_id] ||= []).push({ tagId: r.tag_id, key: r.key, name: r.name, color: r.color, source: r.source });
  }
  pruneOrphanTagsSometimes().catch(() => {});
  return out;
}

// The user adds or removes a tag by hand on one or more messages. Removing keeps the row (dismissed)
// so an automatic source does not put it back; adding again clears that and takes ownership as
// 'manual'. Returns the ids of the messages that were the user's and got the change.
export async function setManualTags(userId, messageIds, tagId, on) {
  if (!messageIds.length) return [];
  const { rows } = await query(
    `WITH owned AS (
       SELECT m.id, m.account_id, tag_email_key(m.message_id, m.id) AS email_key
         FROM messages m
         JOIN email_accounts a ON a.id = m.account_id
        WHERE m.id = ANY($1::uuid[]) AND a.user_id = $3
          AND EXISTS (SELECT 1 FROM tag_definitions d WHERE d.id = $2 AND d.user_id = $3)
     ), written AS (
       INSERT INTO message_tags (account_id, email_key, tag_id, source, dismissed)
       SELECT DISTINCT account_id, email_key, $2::uuid, 'manual', $4::boolean FROM owned
       ON CONFLICT (account_id, email_key, tag_id)
         DO UPDATE SET dismissed = EXCLUDED.dismissed, source = 'manual', orphaned_at = NULL
       RETURNING 1
     )
     SELECT id FROM owned`,
    [messageIds, tagId, userId, !on]
  );
  return rows.map((r) => r.id);
}

export async function setManualTag(userId, messageId, tagId, on) {
  return (await setManualTags(userId, [messageId], tagId, on)).length > 0;
}

// A plugin puts a tag on a message. It never overrides the user: if the user set or removed this tag
// by hand, nothing changes. Returns 'applied', 'unchanged', or 'skipped' (user decision / unknown).
export async function applyTag(userId, messageId, tagKey, source) {
  const { rows } = await query(
    `INSERT INTO message_tags (account_id, email_key, tag_id, source)
     SELECT m.account_id, tag_email_key(m.message_id, m.id), d.id, $4
       FROM messages m
       JOIN email_accounts a ON a.id = m.account_id
       JOIN tag_definitions d ON d.user_id = a.user_id AND d.key = $2
      WHERE m.id = $1 AND a.user_id = $3
     ON CONFLICT (account_id, email_key, tag_id) DO UPDATE SET created_at = NOW(), orphaned_at = NULL
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
      WHERE m.id = $1 AND a.id = m.account_id AND a.user_id = $3
        AND mt.account_id = m.account_id AND mt.email_key = tag_email_key(m.message_id, m.id)
        AND d.id = mt.tag_id AND d.user_id = $3 AND d.key = $2
        AND mt.source = $4 AND NOT mt.dismissed`,
    [messageId, tagKey, userId, source]
  );
  return rowCount > 0;
}

// ── orphans ───────────────────────────────────────────────────────────────────
const ORPHAN_GRACE = "interval '7 days'";
const PRUNE_EVERY_MS = 6 * 60 * 60 * 1000;
let lastPrune = 0;

// Tags whose email no longer exists (permanently deleted) are removed after a grace period. A move is a
// delete followed by an insert, so a row is only marked when no message matches, unmarked if one comes
// back, and deleted when it has stayed marked for the whole grace period.
export async function pruneOrphanTags() {
  const exists = `EXISTS (SELECT 1 FROM messages m WHERE m.account_id = message_tags.account_id
                           AND (m.message_id = message_tags.email_key OR 'row:' || m.id::text = message_tags.email_key))`;
  await query(`UPDATE message_tags SET orphaned_at = NOW() WHERE orphaned_at IS NULL AND NOT ${exists}`);
  await query(`UPDATE message_tags SET orphaned_at = NULL WHERE orphaned_at IS NOT NULL AND ${exists}`);
  const { rowCount } = await query(`DELETE FROM message_tags WHERE orphaned_at IS NOT NULL AND orphaned_at < NOW() - ${ORPHAN_GRACE}`);
  return rowCount;
}

async function pruneOrphanTagsSometimes() {
  if (Date.now() - lastPrune < PRUNE_EVERY_MS) return;
  lastPrune = Date.now();
  await pruneOrphanTags();
}

// INBOX messages of the given accounts (owned by the user), newest first. `withoutAnnotation` limits
// the result to messages a plugin has not processed yet (no annotation of that plugin), plus, with
// `retryStatuses`, those whose last run ended in one of those statuses (e.g. ['error'] to retry failures).
export async function listInboxMessageIds(userId, accountIds, limit, { withoutAnnotation = null, retryStatuses = [] } = {}) {
  if (!accountIds.length) return [];
  const params = [accountIds, userId, limit];
  let pending = '';
  if (withoutAnnotation) {
    params.push(withoutAnnotation);
    const plugin = `$${params.length}`;
    let retry = '';
    if (retryStatuses.length) {
      params.push(retryStatuses);
      retry = ` OR m.plugin_annotations -> ${plugin} -> 'run' ->> 'status' = ANY($${params.length}::text[])`;
    }
    pending = `AND (NOT (m.plugin_annotations ? ${plugin})${retry})`;
  }
  const { rows } = await query(
    `SELECT m.id FROM messages m JOIN email_accounts a ON a.id = m.account_id
      WHERE m.account_id = ANY($1::uuid[]) AND a.user_id = $2 AND m.folder = 'INBOX' AND m.is_deleted = false
        ${pending}
      ORDER BY m.date DESC NULLS LAST LIMIT $3`,
    params
  );
  return rows.map((r) => r.id);
}

// Examples of what a tag means, taken from how the user tagged their own mail: subjects (with the
// sender's name) of messages the user tagged by hand (positives) and of messages where the user
// removed the tag (negatives), newest first. Emails that carry any of `excludeIfTagged` (e.g. a
// privacy tag) are left out so private subjects never leave through here.
export async function listTagExamples(userId, tagKey, { excludeIfTagged = [], limit = 8 } = {}) {
  const run = async (dismissed) => {
    const { rows } = await query(
      `SELECT m.subject, m.from_name
         FROM message_tags mt
         JOIN tag_definitions d ON d.id = mt.tag_id AND d.user_id = $1 AND d.key = $2
         JOIN email_accounts a ON a.id = mt.account_id AND a.user_id = $1
         JOIN LATERAL (
           SELECT m.subject, m.from_name FROM messages m
            WHERE m.account_id = mt.account_id AND (m.message_id = mt.email_key OR 'row:' || m.id::text = mt.email_key)
            ORDER BY m.date DESC NULLS LAST LIMIT 1
         ) m ON true
        WHERE mt.source = 'manual' AND mt.dismissed = $3 AND COALESCE(m.subject, '') <> ''
          AND NOT EXISTS (
            SELECT 1 FROM message_tags x JOIN tag_definitions xd ON xd.id = x.tag_id
             WHERE x.account_id = mt.account_id AND x.email_key = mt.email_key AND NOT x.dismissed
               AND xd.user_id = $1 AND xd.key = ANY($4::text[]))
        ORDER BY mt.created_at DESC LIMIT $5`,
      [userId, tagKey, dismissed, excludeIfTagged, limit]
    );
    return rows.map((r) => ({ subject: r.subject, sender: r.from_name || '' }));
  };
  return { positives: await run(false), negatives: await run(true) };
}
