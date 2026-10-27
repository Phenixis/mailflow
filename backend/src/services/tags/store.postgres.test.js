import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

vi.mock('../db.js', () => ({ query: vi.fn() }));
import { query } from '../db.js';
import * as store from './store.js';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../../../migrations');
const migration0072 = readFileSync(join(migrationsDir, '0072_tags.sql'), 'utf8');
const migration0073 = readFileSync(join(migrationsDir, '0073_tags_by_email.sql'), 'utf8');
const U1 = '00000000-0000-4000-8000-000000000001';
const U2 = '00000000-0000-4000-8000-000000000002';
const A1 = '00000000-0000-4000-8000-0000000000a1';
const A2 = '00000000-0000-4000-8000-0000000000a2';
const M1 = '00000000-0000-4000-8000-0000000000b1';
const M2 = '00000000-0000-4000-8000-0000000000b2';

// Runs the real 0072 migration and the store's SQL in a throwaway schema of an explicitly supplied database.
describe.skipIf(!process.env.MAILFLOW_TEST_DATABASE_URL)('tags store (PostgreSQL)', () => {
  let db;
  const schema = `tags_core_test_${process.pid}`;
  beforeAll(async () => {
    db = new pg.Client({ connectionString: process.env.MAILFLOW_TEST_DATABASE_URL });
    await db.connect();
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema}; SET search_path TO ${schema}, public`);
    await db.query(`
      CREATE TABLE users (id uuid PRIMARY KEY);
      CREATE TABLE email_accounts (id uuid PRIMARY KEY, user_id uuid REFERENCES users(id));
      CREATE TABLE messages (id uuid PRIMARY KEY, account_id uuid REFERENCES email_accounts(id), folder text, uid bigint,
        message_id text, date timestamptz, subject text, from_name text, is_deleted boolean DEFAULT false,
        plugin_annotations jsonb NOT NULL DEFAULT '{}');
      INSERT INTO users VALUES ('${U1}'), ('${U2}');
      INSERT INTO email_accounts VALUES ('${A1}', '${U1}'), ('${A2}', '${U2}');
      INSERT INTO messages (id, account_id, folder, uid, message_id, date) VALUES
        ('${M1}', '${A1}', 'INBOX', 1, '<m1@x.example>', now()),
        ('${M2}', '${A2}', 'INBOX', 1, '<m2@x.example>', now())`);
    await db.query(migration0072);
    await db.query(migration0073);
    query.mockImplementation((sql, params) => db.query(sql, params));
  });
  afterAll(async () => {
    await db?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db?.end();
  });

  it('creates, orders, edits and deletes definitions, scoped to the user', async () => {
    const a = await store.createDefinition(U1, { key: 'urgent', name: 'Urgent', color: '#ef4444' });
    const b = await store.createDefinition(U1, { key: 'travel', name: 'Travel' });
    expect([a.position, b.position]).toEqual([0, 1]);
    expect((await store.listDefinitions(U1)).map((d) => d.key)).toEqual(['urgent', 'travel']);
    expect(await store.listDefinitions(U2)).toEqual([]);
    expect(await store.updateDefinition(U1, b.id, { name: 'Trips', enabled: false })).toMatchObject({ name: 'Trips', enabled: false });
    expect(await store.updateDefinition(U2, b.id, { name: 'hijack' })).toBeNull();
    expect(await store.updateDefinition(U1, b.id, {})).toBeNull();
    expect(await store.deleteDefinition(U2, b.id)).toBe(false);
    expect(await store.deleteDefinition(U1, b.id)).toBe(true);
  });

  it('ensureDefinition creates once and returns the existing tag untouched afterwards', async () => {
    const first = await store.ensureDefinition(U1, { key: 'important', name: 'Important', color: '#f59e0b' });
    await store.updateDefinition(U1, first.id, { name: 'Renamed by user' });
    const again = await store.ensureDefinition(U1, { key: 'important', name: 'Important', color: '#f59e0b' });
    expect(again.id).toBe(first.id);
    expect(again.name).toBe('Renamed by user');
  });

  it('a manual tag, removal and re-adding behave, and reads are scoped to the owner', async () => {
    const urgent = (await store.listDefinitions(U1)).find((d) => d.key === 'urgent');
    expect(await store.setManualTag(U1, M1, urgent.id, true)).toBe(true);
    expect((await store.tagsForMessages(U1, [M1]))[M1].map((t) => [t.key, t.source])).toEqual([['urgent', 'manual']]);
    expect(await store.tagsForMessages(U2, [M1])).toEqual({});
    expect(await store.setManualTag(U2, M1, urgent.id, true)).toBe(false); // not their message or tag
    await store.setManualTag(U1, M1, urgent.id, false);
    expect(await store.tagsForMessages(U1, [M1])).toEqual({});
    await store.setManualTag(U1, M1, urgent.id, true);
    expect((await store.tagsForMessages(U1, [M1]))[M1]).toHaveLength(1);
  });

  it('sets a tag on several messages at once, only for the ones the user owns', async () => {
    const defs = await store.listDefinitions(U1);
    const travel = await store.createDefinition(U1, { key: 'trip', name: 'Trip' });
    expect(defs.length).toBeGreaterThan(0);
    expect(await store.setManualTags(U1, [M1, M2], travel.id, true)).toEqual([M1]); // M2 belongs to U2
    expect((await store.tagsForMessages(U1, [M1]))[M1].map((t) => t.key)).toContain('trip');
    expect(await store.setManualTags(U1, [M1], travel.id, false)).toEqual([M1]);
    expect((await store.tagsForMessages(U1, [M1]))[M1].map((t) => t.key)).not.toContain('trip');
    expect(await store.setManualTags(U1, [], travel.id, true)).toEqual([]);
    await store.deleteDefinition(U1, travel.id);
  });

  it('a plugin applies and removes only its own tags and never overrides the user', async () => {
    const defs = await store.listDefinitions(U1);
    const urgent = defs.find((d) => d.key === 'urgent');
    const important = defs.find((d) => d.key === 'important');
    // user set "urgent" by hand on M1 earlier -> the plugin cannot touch it
    expect(await store.applyTag(U1, M1, 'urgent', 'jev-tags')).toBe('skipped');
    expect(await store.removeTag(U1, M1, 'urgent', 'jev-tags')).toBe(false);
    // new tag from the plugin
    expect(await store.applyTag(U1, M1, 'important', 'jev-tags')).toBe('applied');
    expect(await store.applyTag(U1, M1, 'important', 'jev-tags')).toBe('unchanged');
    expect((await store.tagsForMessages(U1, [M1]))[M1].map((t) => `${t.key}:${t.source}`)).toEqual(['urgent:manual', 'important:jev-tags']);
    // the user dismisses it: the plugin may not bring it back
    await store.setManualTag(U1, M1, important.id, false);
    expect(await store.applyTag(U1, M1, 'important', 'jev-tags')).toBe('skipped');
    expect((await store.tagsForMessages(U1, [M1]))[M1].map((t) => t.key)).toEqual(['urgent']);
    // scoping and unknown tags
    expect(await store.applyTag(U2, M1, 'important', 'jev-tags')).toBe('skipped');
    expect(await store.applyTag(U1, M1, 'nonexistent', 'jev-tags')).toBe('skipped');
    // a plugin removes what it applied
    await store.setManualTag(U1, M1, urgent.id, false);
    expect(await store.applyTag(U1, M1, 'urgent', 'jev-tags')).toBe('skipped');
  });

  it('removeTag deletes a plugin-applied tag', async () => {
    await store.createDefinition(U2, { key: 'urgent', name: 'Urgent' });
    expect(await store.applyTag(U2, M2, 'urgent', 'jev-tags')).toBe('applied');
    expect(await store.removeTag(U2, M2, 'urgent', 'other-plugin')).toBe(false);
    expect(await store.removeTag(U2, M2, 'urgent', 'jev-tags')).toBe(true);
    expect(await store.tagsForMessages(U2, [M2])).toEqual({});
    expect(await store.applyTag(U2, M2, 'urgent', 'jev-tags')).toBe('applied'); // not dismissed, so it can return
  });

  it('gives examples from how the user tagged, leaving out messages carrying an excluded tag', async () => {
    await db.query(`INSERT INTO messages (id, account_id, folder, date, subject, from_name) VALUES
      ('00000000-0000-4000-8000-0000000000c1', '${A1}', 'INBOX', now(), 'Flight to Rome', 'Airline'),
      ('00000000-0000-4000-8000-0000000000c2', '${A1}', 'INBOX', now(), 'Secret flight', 'Airline'),
      ('00000000-0000-4000-8000-0000000000c3', '${A1}', 'INBOX', now(), 'Newsletter', 'News'),
      ('00000000-0000-4000-8000-0000000000c4', '${A1}', 'INBOX', now(), '', 'No subject')`);
    const trip = await store.createDefinition(U1, { key: 'trips', name: 'Trips' });
    const secret = await store.createDefinition(U1, { key: 'secret', name: 'Secret' });
    const c = (n) => `00000000-0000-4000-8000-0000000000c${n}`;
    await store.setManualTags(U1, [c(1), c(2), c(4)], trip.id, true);
    await store.setManualTags(U1, [c(3)], trip.id, false); // the user said "not a trip"
    await store.setManualTags(U1, [c(2)], secret.id, true);
    await store.applyTag(U1, c(3), 'secret', 'jev-tags'); // an automatic tag is not "the user's own"
    const all = await store.listTagExamples(U1, 'trips');
    expect(all.positives.map((e) => e.subject).sort()).toEqual(['Flight to Rome', 'Secret flight']); // empty subject skipped
    expect(all.negatives).toEqual([{ subject: 'Newsletter', sender: 'News' }]);
    const safe = await store.listTagExamples(U1, 'trips', { excludeIfTagged: ['secret'] });
    expect(safe.positives).toEqual([{ subject: 'Flight to Rome', sender: 'Airline' }]);
    expect((await store.listTagExamples(U1, 'trips', { limit: 1 })).positives).toHaveLength(1);
    expect(await store.listTagExamples(U2, 'trips')).toEqual({ positives: [], negatives: [] });
    await store.deleteDefinition(U1, trip.id);
    await store.deleteDefinition(U1, secret.id);
    await db.query("DELETE FROM messages WHERE id::text LIKE '00000000-0000-4000-8000-0000000000c%'");
  });

  it('lists INBOX messages, optionally only those a plugin has not annotated', async () => {
    expect(await store.listInboxMessageIds(U1, [A1], 10)).toEqual([M1]);
    expect(await store.listInboxMessageIds(U1, [A2], 10)).toEqual([]); // not the user's account
    expect(await store.listInboxMessageIds(U1, [], 10)).toEqual([]);
    expect(await store.listInboxMessageIds(U1, [A1], 10, { withoutAnnotation: 'jev-tags' })).toEqual([M1]);
    await db.query(`UPDATE messages SET plugin_annotations = '{"jev-tags": {"run": {}}}' WHERE id = '${M1}'`);
    expect(await store.listInboxMessageIds(U1, [A1], 10, { withoutAnnotation: 'jev-tags' })).toEqual([]);
    expect(await store.listInboxMessageIds(U1, [A1], 10)).toEqual([M1]);
    // a failed run can be picked up again, a finished one cannot
    await db.query(`UPDATE messages SET plugin_annotations = '{"jev-tags": {"run": {"status": "error"}}}' WHERE id = '${M1}'`);
    expect(await store.listInboxMessageIds(U1, [A1], 10, { withoutAnnotation: 'jev-tags' })).toEqual([]);
    expect(await store.listInboxMessageIds(U1, [A1], 10, { withoutAnnotation: 'jev-tags', retryStatuses: ['error'] })).toEqual([M1]);
    await db.query(`UPDATE messages SET plugin_annotations = '{"jev-tags": {"run": {"status": "done"}}}' WHERE id = '${M1}'`);
    expect(await store.listInboxMessageIds(U1, [A1], 10, { withoutAnnotation: 'jev-tags', retryStatuses: ['error'] })).toEqual([]);
  });

  it('cascades: deleting a tag, or the account, removes the links', async () => {
    const urgent = (await store.listDefinitions(U1)).find((d) => d.key === 'urgent');
    await store.setManualTags(U1, [M1], urgent.id, true);
    await store.deleteDefinition(U1, urgent.id);
    expect((await db.query('SELECT 1 FROM message_tags WHERE tag_id = $1', [urgent.id])).rowCount).toBe(0);
  });
});

// The statements MailFlow runs when a message is trashed, moved or resynced, replayed against real tables:
// they used to fail (foreign key) or silently drop the tags.
describe.skipIf(!process.env.MAILFLOW_TEST_DATABASE_URL)('tags follow the email (PostgreSQL)', () => {
  let db;
  const schema = `tags_follow_test_${process.pid}`;
  const E1 = '00000000-0000-4000-8000-0000000000e1';
  const E2 = '00000000-0000-4000-8000-0000000000e2';
  const E3 = '00000000-0000-4000-8000-0000000000e3';
  const keysOf = async (id) => ((await store.tagsForMessages(U1, [id]))[id] || []).map((t) => t.key).sort();
  let urgent;
  let important;

  beforeAll(async () => {
    db = new pg.Client({ connectionString: process.env.MAILFLOW_TEST_DATABASE_URL });
    await db.connect();
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema}; SET search_path TO ${schema}, public`);
    await db.query(`
      CREATE TABLE users (id uuid PRIMARY KEY);
      CREATE TABLE email_accounts (id uuid PRIMARY KEY, user_id uuid REFERENCES users(id));
      CREATE TABLE messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid REFERENCES email_accounts(id), folder text, uid bigint,
        message_id text, date timestamptz, subject text, from_name text, is_deleted boolean DEFAULT false,
        plugin_annotations jsonb NOT NULL DEFAULT '{}', UNIQUE (account_id, uid, folder));
      INSERT INTO users VALUES ('${U1}');
      INSERT INTO email_accounts VALUES ('${A1}', '${U1}');`);
    await db.query(migration0072);
    await db.query(migration0073);
    query.mockImplementation((sql, params) => db.query(sql, params));
    urgent = await store.createDefinition(U1, { key: 'urgent', name: 'Urgent' });
    important = await store.createDefinition(U1, { key: 'important', name: 'Important' });
  });
  afterAll(async () => {
    await db?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db?.end();
  });

  it('keeps the tags when a message is trashed (the row gets a new id, as in routes/mail.js)', async () => {
    await db.query(`INSERT INTO messages (id, account_id, folder, uid, message_id, subject) VALUES ('${E1}', '${A1}', 'INBOX', 10, '<e1@x.example>', 'Trash me')`);
    await store.setManualTags(U1, [E1], urgent.id, true);
    // exactly the statement of the "move to Trash" delete
    await db.query('UPDATE messages SET folder = $1, uid = $2, id = gen_random_uuid() WHERE id = $3', ['Trash', 99, E1]);
    const moved = (await db.query("SELECT id FROM messages WHERE message_id = '<e1@x.example>'")).rows[0].id;
    expect(moved).not.toBe(E1);
    expect(await keysOf(moved)).toEqual(['urgent']);
    expect(await store.listTagExamples(U1, 'urgent')).toEqual({ positives: [{ subject: 'Trash me', sender: '' }], negatives: [] });
  });

  it('keeps the tags through a bulk move (delete + reinsert with a new id) and a resync', async () => {
    await db.query(`INSERT INTO messages (id, account_id, folder, uid, message_id, subject) VALUES ('${E2}', '${A1}', 'INBOX', 20, '<e2@x.example>', 'Move me')`);
    await store.setManualTags(U1, [E2], important.id, true);
    // the bulk relocate: DELETE ... RETURNING then INSERT into the destination folder, id left to its default
    const { rows: [old] } = await db.query(`DELETE FROM messages WHERE id = '${E2}' RETURNING *`);
    await db.query(
      'INSERT INTO messages (account_id, folder, uid, message_id, subject) VALUES ($1, $2, $3, $4, $5)',
      [old.account_id, 'Archive', 55, old.message_id, old.subject]
    );
    const archived = (await db.query("SELECT id FROM messages WHERE message_id = '<e2@x.example>'")).rows[0].id;
    expect(await keysOf(archived)).toEqual(['important']);
    // the tag can still be changed from the new row, and a dismissal stays with the email
    await store.setManualTags(U1, [archived], important.id, false);
    await db.query(`DELETE FROM messages WHERE id = '${archived}'`);
    await db.query('INSERT INTO messages (account_id, folder, uid, message_id) VALUES ($1, $2, $3, $4)', [A1, 'INBOX', 21, '<e2@x.example>']);
    const again = (await db.query("SELECT id FROM messages WHERE message_id = '<e2@x.example>'")).rows[0].id;
    expect(await keysOf(again)).toEqual([]);
    expect(await store.applyTag(U1, again, 'important', 'jev-tags')).toBe('skipped'); // still dismissed by the user
  });

  it('deleting a message permanently does not fail, and its tags are pruned after a grace period', async () => {
    await db.query(`INSERT INTO messages (id, account_id, folder, uid, message_id) VALUES ('${E3}', '${A1}', 'Trash', 30, '<e3@x.example>')`);
    await store.setManualTags(U1, [E3], urgent.id, true);
    await db.query(`DELETE FROM messages WHERE id = '${E3}'`); // the permanent delete (message already in Trash)
    const count = async () => Number((await db.query("SELECT count(*) FROM message_tags WHERE email_key = '<e3@x.example>'")).rows[0].count);
    expect(await count()).toBe(1); // kept for now: a moved message is also a delete followed by an insert
    await store.pruneOrphanTags();
    expect(await count()).toBe(1); // marked, within the grace period
    expect((await db.query("SELECT orphaned_at FROM message_tags WHERE email_key = '<e3@x.example>'")).rows[0].orphaned_at).not.toBeNull();
    await db.query("UPDATE message_tags SET orphaned_at = NOW() - interval '8 days' WHERE email_key = '<e3@x.example>'");
    await store.pruneOrphanTags();
    expect(await count()).toBe(0);
  });

  it('a mark is cleared when the email comes back before the grace period ends', async () => {
    const key = '<e4@x.example>';
    await db.query('INSERT INTO messages (id, account_id, folder, uid, message_id) VALUES (gen_random_uuid(), $1, $2, $3, $4)', [A1, 'INBOX', 40, key]);
    const id = (await db.query('SELECT id FROM messages WHERE message_id = $1', [key])).rows[0].id;
    await store.setManualTags(U1, [id], urgent.id, true);
    await db.query('DELETE FROM messages WHERE id = $1', [id]);
    await store.pruneOrphanTags(); // marked
    await db.query('INSERT INTO messages (account_id, folder, uid, message_id) VALUES ($1, $2, $3, $4)', [A1, 'Archive', 41, key]);
    await store.pruneOrphanTags(); // unmarked
    expect((await db.query('SELECT orphaned_at FROM message_tags WHERE email_key = $1', [key])).rows[0].orphaned_at).toBeNull();
    await db.query("UPDATE message_tags SET orphaned_at = NOW() - interval '30 days' WHERE email_key = $1", [key]);
    await store.pruneOrphanTags();
    expect((await db.query('SELECT 1 FROM message_tags WHERE email_key = $1', [key])).rowCount).toBe(1); // a live email is never pruned
  });

  it('two copies of an email (e.g. a label folder) share its tags', async () => {
    await db.query(`INSERT INTO messages (account_id, folder, uid, message_id, subject) VALUES ('${A1}', 'INBOX', 50, '<copy@x.example>', 'Shared'), ('${A1}', 'Todo', 7, '<copy@x.example>', 'Shared')`);
    const ids = (await db.query("SELECT id FROM messages WHERE message_id = '<copy@x.example>' ORDER BY uid")).rows.map((r) => r.id);
    await store.setManualTags(U1, [ids[0]], important.id, true);
    expect(await keysOf(ids[1])).toEqual(['important']);
    expect((await db.query("SELECT count(*) FROM message_tags WHERE email_key = '<copy@x.example>'")).rows[0].count).toBe('1');
  });

  it('a message without a Message-ID is tagged by its row id (and keeps the tag until the row id changes)', async () => {
    await db.query("INSERT INTO messages (account_id, folder, uid, message_id, subject) VALUES ($1, 'INBOX', 60, NULL, 'No header')", [A1]);
    const id = (await db.query("SELECT id FROM messages WHERE subject = 'No header'")).rows[0].id;
    expect(await store.setManualTags(U1, [id], urgent.id, true)).toEqual([id]);
    expect(await keysOf(id)).toEqual(['urgent']);
  });
});

// The upgrade of a database that already holds tags keyed by the row id (migration 0072 as first shipped).
describe.skipIf(!process.env.MAILFLOW_TEST_DATABASE_URL)('migration 0073 converts existing tags (PostgreSQL)', () => {
  it('re-keys tags by email, merges copies, drops tags of messages that no longer exist', async () => {
    const schemaName = `tags_migrate_test_${process.pid}`;
    const c = new pg.Client({ connectionString: process.env.MAILFLOW_TEST_DATABASE_URL });
    await c.connect();
    try {
      await c.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE; CREATE SCHEMA ${schemaName}; SET search_path TO ${schemaName}, public`);
      await c.query(`
        CREATE TABLE users (id uuid PRIMARY KEY);
        CREATE TABLE email_accounts (id uuid PRIMARY KEY, user_id uuid REFERENCES users(id));
        CREATE TABLE messages (id uuid PRIMARY KEY, account_id uuid REFERENCES email_accounts(id), message_id text);
        INSERT INTO users VALUES ('${U1}');
        INSERT INTO email_accounts VALUES ('${A1}', '${U1}');
        INSERT INTO messages VALUES
          ('00000000-0000-4000-8000-0000000000f1', '${A1}', '<a@x.example>'),
          ('00000000-0000-4000-8000-0000000000f2', '${A1}', '<a@x.example>'),
          ('00000000-0000-4000-8000-0000000000f3', '${A1}', NULL)`);
      await c.query(migration0072);
      await c.query(`
        INSERT INTO tag_definitions (id, user_id, key, name) VALUES ('00000000-0000-4000-8000-0000000000d1', '${U1}', 'urgent', 'Urgent');
        INSERT INTO message_tags (message_id, tag_id, source) VALUES
          ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000d1', 'manual'),
          ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000d1', 'manual'),
          ('00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000d1', 'jev-tags')`);
      await c.query(migration0073);
      const { rows } = await c.query('SELECT email_key, source FROM message_tags ORDER BY email_key');
      expect(rows).toEqual([
        { email_key: '<a@x.example>', source: 'manual' }, // the two copies became one
        { email_key: 'row:00000000-0000-4000-8000-0000000000f3', source: 'jev-tags' }, // no Message-ID: row key
      ]);
      expect((await c.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'message_tags' AND column_name = 'message_id'")).rowCount).toBe(0);
      await c.query(migration0073); // running it again is harmless (a fresh install runs 0072 then 0073)
      expect((await c.query('SELECT count(*) FROM message_tags')).rows[0].count).toBe('2');
    } finally {
      await c.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
      await c.end();
    }
  });
});
