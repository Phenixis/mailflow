import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

vi.mock('../db.js', () => ({ query: vi.fn() }));
import { query } from '../db.js';
import * as store from './store.js';

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../../../migrations');
const read = (name) => readFileSync(join(migrations, name), 'utf8');
const U1 = '00000000-0000-4000-8000-000000000001';
const U2 = '00000000-0000-4000-8000-000000000002';
const A1 = '00000000-0000-4000-8000-0000000000a1';
const A2 = '00000000-0000-4000-8000-0000000000a2';
const M1 = '00000000-0000-4000-8000-0000000000b1';
const M2 = '00000000-0000-4000-8000-0000000000b2';
const c = (n) => `00000000-0000-4000-8000-0000000000c${n}`;

const SCHEMA_SQL = `
  CREATE TABLE users (id uuid PRIMARY KEY);
  CREATE TABLE email_accounts (id uuid PRIMARY KEY, user_id uuid REFERENCES users(id));
  CREATE TABLE messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid REFERENCES email_accounts(id), folder text, uid bigint,
    message_id text, date timestamptz, subject text, from_name text, is_deleted boolean DEFAULT false,
    plugin_annotations jsonb NOT NULL DEFAULT '{}');
  INSERT INTO users VALUES ('${U1}'), ('${U2}');
  INSERT INTO email_accounts VALUES ('${A1}', '${U1}'), ('${A2}', '${U2}');
  INSERT INTO messages (id, account_id, folder, uid, message_id, date) VALUES
    ('${M1}', '${A1}', 'INBOX', 1, '<m1@x.example>', now()),
    ('${M2}', '${A2}', 'INBOX', 1, '<m2@x.example>', now())`;

// What a tagging plugin needs on top of hand-made tags, run against the real migrations in a throwaway
// schema of an explicitly supplied database.
describe.skipIf(!process.env.MAILFLOW_TEST_DATABASE_URL)('tags store, plugin support (PostgreSQL)', () => {
  let db;
  const schema = `tags_plugin_test_${process.pid}`;
  const keysOf = async (userId, id) => ((await store.tagsForMessages(userId, [id]))[id] || []).map((t) => `${t.key}:${t.source}`);

  beforeAll(async () => {
    db = new pg.Client({ connectionString: process.env.MAILFLOW_TEST_DATABASE_URL });
    await db.connect();
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema}; SET search_path TO ${schema}, public`);
    await db.query(SCHEMA_SQL);
    await db.query(read('0079_tags.sql'));
    await db.query(read('0082_tags_plugin_columns.sql'));
    await db.query(read('0082_tags_plugin_columns.sql')); // idempotent: the runner may replay it
    query.mockImplementation((sql, params) => db.query(sql, params));
  });
  afterAll(async () => {
    await db?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db?.end();
  });

  it('ensureDefinition creates once, returns the existing tag untouched afterwards, and is scoped to the user', async () => {
    const first = await store.ensureDefinition(U1, { key: 'important', name: 'Important', color: '#f59e0b' });
    expect(first).toMatchObject({ key: 'important', name: 'Important', color: '#f59e0b' });
    await store.updateDefinition(U1, first.id, { name: 'Renamed by user' });
    const again = await store.ensureDefinition(U1, { key: 'important', name: 'Important', color: '#f59e0b' });
    expect(again.id).toBe(first.id);
    expect(again.name).toBe('Renamed by user');
    const other = await store.ensureDefinition(U2, { key: 'important', name: 'Important' });
    expect(other.id).not.toBe(first.id);
  });

  it('ensureDefinition gives its key to a tag the user already made by hand under that name', async () => {
    const byHand = await store.createDefinition(U1, { name: 'Newsletters' });
    expect(byHand.key).toBeNull();
    const ensured = await store.ensureDefinition(U1, { key: 'newsletters', name: 'newsletters', color: '#10b981' });
    expect(ensured.id).toBe(byHand.id);
    expect(ensured.key).toBe('newsletters');
    expect((await store.listDefinitions(U1)).filter((d) => d.name.toLowerCase() === 'newsletters')).toHaveLength(1);
  });

  it('ensureDefinition returns null when the name belongs to a tag with another key', async () => {
    await store.ensureDefinition(U1, { key: 'billing', name: 'Billing' });
    expect(await store.ensureDefinition(U1, { key: 'invoices', name: 'Billing' })).toBeNull();
  });

  it('a plugin applies and removes only its own tags and never overrides the user', async () => {
    const urgent = await store.ensureDefinition(U1, { key: 'urgent', name: 'Urgent' });
    const important = (await store.listDefinitions(U1)).find((d) => d.key === 'important');
    await store.setManualTag(U1, M1, urgent.id, true);
    // the user set "urgent" by hand: the plugin cannot touch it
    expect(await store.applyTag(U1, M1, 'urgent', 'jev-tags')).toBe('skipped');
    expect(await store.removeTag(U1, M1, 'urgent', 'jev-tags')).toBe(false);
    // a new tag from the plugin
    expect(await store.applyTag(U1, M1, 'important', 'jev-tags')).toBe('applied');
    expect(await store.applyTag(U1, M1, 'important', 'jev-tags')).toBe('unchanged');
    expect(await keysOf(U1, M1)).toEqual(['important:jev-tags', 'urgent:manual']);
    // the user takes it off: the plugin may not bring it back
    await store.setManualTag(U1, M1, important.id, false);
    expect(await store.applyTag(U1, M1, 'important', 'jev-tags')).toBe('skipped');
    expect(await keysOf(U1, M1)).toEqual(['urgent:manual']);
    // scoping and unknown tags
    expect(await store.applyTag(U2, M1, 'important', 'jev-tags')).toBe('skipped');
    expect(await store.applyTag(U1, M1, 'nonexistent', 'jev-tags')).toBe('skipped');
    // the user's own removal of a tag the plugin never set also holds
    await store.setManualTag(U1, M1, urgent.id, false);
    expect(await store.applyTag(U1, M1, 'urgent', 'jev-tags')).toBe('skipped');
  });

  it('adding a tag by hand again takes it back from a plugin and from a dismissal', async () => {
    const important = (await store.listDefinitions(U1)).find((d) => d.key === 'important');
    await store.setManualTag(U1, M1, important.id, true);
    expect(await keysOf(U1, M1)).toEqual(['important:manual']);
    await store.setManualTag(U1, M1, important.id, false);
    await store.setManualTag(U1, M1, important.id, false); // nothing left to remove is not an error
    expect(await keysOf(U1, M1)).toEqual([]);
  });

  it('removeTag only removes what the same plugin applied, and a removed tag can be applied again', async () => {
    await store.ensureDefinition(U2, { key: 'urgent', name: 'Urgent' });
    expect(await store.applyTag(U2, M2, 'urgent', 'jev-tags')).toBe('applied');
    expect(await store.removeTag(U2, M2, 'urgent', 'other-plugin')).toBe(false);
    expect(await store.removeTag(U2, M2, 'urgent', 'jev-tags')).toBe(true);
    expect(await store.tagsForMessages(U2, [M2])).toEqual({});
    expect(await store.applyTag(U2, M2, 'urgent', 'jev-tags')).toBe('applied'); // not dismissed, so it can return
  });

  it('gives examples from how the user tagged, leaving out messages carrying an excluded tag', async () => {
    await db.query(`INSERT INTO messages (id, account_id, folder, date, subject, from_name) VALUES
      ('${c(1)}', '${A1}', 'INBOX', now(), 'Flight to Rome', 'Airline'),
      ('${c(2)}', '${A1}', 'INBOX', now(), 'Secret flight', 'Airline'),
      ('${c(3)}', '${A1}', 'INBOX', now(), 'Newsletter', 'News'),
      ('${c(4)}', '${A1}', 'INBOX', now(), '', 'No subject')`);
    const trip = await store.ensureDefinition(U1, { key: 'trips', name: 'Trips' });
    const secret = await store.ensureDefinition(U1, { key: 'secret', name: 'Secret' });
    for (const n of [1, 2, 4]) await store.setManualTag(U1, c(n), trip.id, true);
    await store.setManualTag(U1, c(3), trip.id, false); // the user said "not a trip"
    await store.setManualTag(U1, c(2), secret.id, true);
    await store.applyTag(U1, c(3), 'secret', 'jev-tags'); // an automatic tag is not "the user's own"
    const all = await store.listTagExamples(U1, 'trips');
    expect(all.positives.map((e) => e.subject).sort()).toEqual(['Flight to Rome', 'Secret flight']); // empty subject skipped
    expect(all.negatives).toEqual([{ subject: 'Newsletter', sender: 'News' }]);
    const safe = await store.listTagExamples(U1, 'trips', { excludeIfTagged: ['secret'] });
    expect(safe.positives).toEqual([{ subject: 'Flight to Rome', sender: 'Airline' }]);
    expect((await store.listTagExamples(U1, 'trips', { limit: 1 })).positives).toHaveLength(1);
    expect(await store.listTagExamples(U2, 'trips')).toEqual({ positives: [], negatives: [] });
    await db.query(`DELETE FROM messages WHERE id IN ('${c(1)}', '${c(2)}', '${c(3)}', '${c(4)}')`);
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
});

// An install that ran the fork's earlier tag migrations has `key NOT NULL` and the plugin columns; the
// upstream tags migration then does nothing, so 0082 has to make a hand-made tag possible there.
describe.skipIf(!process.env.MAILFLOW_TEST_DATABASE_URL)('0082 on a schema the fork already migrated (PostgreSQL)', () => {
  let db;
  const schema = `tags_fork_test_${process.pid}`;
  beforeAll(async () => {
    db = new pg.Client({ connectionString: process.env.MAILFLOW_TEST_DATABASE_URL });
    await db.connect();
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema}; SET search_path TO ${schema}, public`);
    await db.query(SCHEMA_SQL);
    await db.query(read('0079_tags.sql'));
    await db.query(`
      ALTER TABLE tag_definitions
        ADD COLUMN key VARCHAR(40) NOT NULL DEFAULT 'legacy', ADD COLUMN position INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT true, ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      ALTER TABLE tag_definitions ALTER COLUMN key DROP DEFAULT;
      ALTER TABLE tag_definitions ADD UNIQUE (user_id, key);
      ALTER TABLE message_tags ADD COLUMN source VARCHAR(40) NOT NULL DEFAULT 'manual', ADD COLUMN dismissed BOOLEAN NOT NULL DEFAULT false;
      INSERT INTO tag_definitions (user_id, key, name) VALUES ('${U1}', 'urgent', 'Urgent')`);
    await db.query(read('0082_tags_plugin_columns.sql'));
    query.mockImplementation((sql, params) => db.query(sql, params));
  });
  afterAll(async () => {
    await db?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db?.end();
  });

  it('keeps the existing keyed tags and accepts a tag made by hand', async () => {
    const created = await store.createDefinition(U1, { name: 'By hand' });
    expect(created.key).toBeNull();
    expect((await store.listDefinitions(U1)).map((d) => d.key)).toEqual(['urgent', null]);
    expect((await store.ensureDefinition(U1, { key: 'urgent', name: 'Urgent' })).key).toBe('urgent');
  });
});
