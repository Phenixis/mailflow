// Tags on messages: definitions, and which messages carry which tag. A tag belongs to a user; a
// message belongs to the user's account. Every read and write here is scoped to the owning user.
//
// A tag follows the email's Message-ID, not the row, so it survives a move and a resync. Known limits:
//   - Mail without a Message-ID is keyed by its row id ('row:<uuid>'). A move to Trash or Archive, or a
//     restore that recreates rows, gives it a new id, so it loses its tags.
//   - Different messages that share a Message-ID in one account share their tags.
//   - Tags of an email that is gone are pruned after a 7-day grace period; mail that comes back later
//     starts untagged.
import { query } from '../db.js';

const DEF_COLUMNS = 'id, key, name, color';
export const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

export async function listDefinitions(userId) {
  const { rows } = await query(
    `SELECT ${DEF_COLUMNS} FROM tag_definitions WHERE user_id = $1 ORDER BY created_at, id`,
    [userId]
  );
  return rows;
}

// Returns null when the user already has a tag with that name (compared without regard to case).
export async function createDefinition(userId, { name, color = '#6b7280' }) {
  const { rows } = await query(
    `INSERT INTO tag_definitions (user_id, name, color) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, lower(name)) DO NOTHING
     RETURNING ${DEF_COLUMNS}`,
    [userId, name, color]
  );
  return rows[0] || null;
}

// A plugin's tag, by key. Returns the user's tag with that key, creating it when there is none. A tag
// the user made by hand under the same name is adopted (given the key) rather than duplicated. Returns
// null when the name belongs to a tag that already has another key.
export async function ensureDefinition(userId, { key, name, color = '#6b7280' }) {
  const byKey = () => query(`SELECT ${DEF_COLUMNS} FROM tag_definitions WHERE user_id = $1 AND key = $2`, [userId, key]);
  const existing = (await byKey()).rows[0];
  if (existing) return existing;
  const adopted = await query(
    `UPDATE tag_definitions SET key = $2
      WHERE user_id = $1 AND key IS NULL AND lower(name) = lower($3)
      RETURNING ${DEF_COLUMNS}`,
    [userId, key, name]
  );
  if (adopted.rows[0]) return adopted.rows[0];
  const created = await query(
    `INSERT INTO tag_definitions (user_id, key, name, color) VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING RETURNING ${DEF_COLUMNS}`,
    [userId, key, name, color]
  );
  return created.rows[0] || (await byKey()).rows[0] || null;
}

// Returns the updated tag, null when it is not the user's, or 'duplicate' when the new name is taken.
export async function updateDefinition(userId, id, patch) {
  const sets = [];
  const params = [userId, id];
  for (const field of ['name', 'color']) {
    if (!(field in patch)) continue;
    params.push(patch[field]);
    sets.push(`${field} = $${params.length}`);
  }
  if (!sets.length) return null;
  try {
    const { rows } = await query(
      `UPDATE tag_definitions SET ${sets.join(', ')} WHERE user_id = $1 AND id = $2 RETURNING ${DEF_COLUMNS}`,
      params
    );
    return rows[0] || null;
  } catch (err) {
    if (err.code === '23505') return 'duplicate';
    throw err;
  }
}

export async function deleteDefinition(userId, id) {
  const { rowCount } = await query('DELETE FROM tag_definitions WHERE user_id = $1 AND id = $2', [userId, id]);
  return rowCount > 0;
}

// Tags currently on each message, for messages the user owns. A tag belongs to the email (account +
// Message-ID, see tag_email_key), so it shows on every row of that email.
export async function tagsForMessages(userId, messageIds) {
  if (!messageIds.length) return {};
  const { rows } = await query(
    `SELECT m.id AS message_id, d.id AS tag_id, d.key, d.name, d.color, mt.source
       FROM messages m
       JOIN email_accounts a ON a.id = m.account_id
       JOIN message_tags mt ON mt.account_id = m.account_id AND mt.email_key = tag_email_key(m.message_id, m.id)
       JOIN tag_definitions d ON d.id = mt.tag_id
      WHERE m.id = ANY($1::uuid[]) AND a.user_id = $2 AND d.user_id = $2 AND NOT mt.dismissed
      ORDER BY d.created_at, d.id`,
    [messageIds, userId]
  );
  const out = {};
  for (const r of rows) {
    (out[r.message_id] ||= []).push({ tagId: r.tag_id, key: r.key, name: r.name, color: r.color, source: r.source });
  }
  pruneOrphanTagsSometimes().catch((err) => console.warn('[tags] pruning orphaned tags failed:', err.message));
  return out;
}

// The user adds or removes a tag by hand on a message. Removing keeps the row (dismissed) so a plugin
// does not put the tag back; adding again clears that and takes ownership as 'manual'. Returns false
// when the message or the tag is not the user's.
export async function setManualTag(userId, messageId, tagId, on) {
  const { rows } = await query(
    `WITH owned AS (
       SELECT m.account_id, tag_email_key(m.message_id, m.id) AS email_key
         FROM messages m
         JOIN email_accounts a ON a.id = m.account_id
        WHERE m.id = $1 AND a.user_id = $3
          AND EXISTS (SELECT 1 FROM tag_definitions d WHERE d.id = $2 AND d.user_id = $3)
     ), written AS (
       INSERT INTO message_tags (account_id, email_key, tag_id, source, dismissed)
       SELECT account_id, email_key, $2::uuid, 'manual', NOT $4::boolean FROM owned
       ON CONFLICT (account_id, email_key, tag_id)
         DO UPDATE SET dismissed = EXCLUDED.dismissed, source = 'manual', orphaned_at = NULL
       RETURNING 1
     )
     SELECT 1 FROM owned`,
    [messageId, tagId, userId, on]
  );
  return rows.length > 0;
}

// Every row of the same email that the user has (the same message in another folder, or in All Inboxes),
// including `messageId` itself. Empty when the message is not the user's.
export async function copiesOfMessage(userId, messageId) {
  const { rows } = await query(
    `SELECT c.id
       FROM messages m
       JOIN email_accounts a ON a.id = m.account_id
       JOIN messages c ON c.account_id = m.account_id
        AND (c.id = m.id OR (NULLIF(m.message_id, '') IS NOT NULL AND c.message_id = m.message_id))
      WHERE m.id = $1 AND a.user_id = $2`,
    [messageId, userId]
  );
  return rows.map((r) => r.id);
}

// ── orphans ───────────────────────────────────────────────────────────────────
const ORPHAN_GRACE = "interval '7 days'";
const PRUNE_EVERY_MS = 6 * 60 * 60 * 1000;
let lastPrune = 0;

// Tags whose email no longer exists (permanently deleted) are removed after a grace period. A move is a
// delete followed by an insert, so a row is only marked when no message matches, unmarked if one comes
// back, and deleted when it has stayed marked for the whole grace period.
export async function pruneOrphanTags() {
  // Compare the uuid, not 'row:' || id::text, so both halves can use an index. The CASE keeps the
  // cast away from Message-ID keys, which an AND would not guarantee.
  const exists = `EXISTS (SELECT 1 FROM messages m WHERE m.account_id = message_tags.account_id
                           AND (m.message_id = message_tags.email_key
                                OR m.id = CASE WHEN message_tags.email_key LIKE 'row:%' THEN substr(message_tags.email_key, 5)::uuid END))`;
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

// ── plugins ───────────────────────────────────────────────────────────────────
// A plugin puts a tag on a message. It never overrides the user: if the user set or removed this tag
// by hand, nothing changes. Returns 'applied', 'unchanged', or 'skipped' (user decision / unknown tag).
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
            WHERE m.account_id = mt.account_id
              AND (m.message_id = mt.email_key
                   OR m.id = CASE WHEN mt.email_key LIKE 'row:%' THEN substr(mt.email_key, 5)::uuid END)
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
