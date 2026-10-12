import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
vi.mock('../db.js', () => ({ query: vi.fn() }));
import { query } from '../db.js';
import * as store from './store.js';
import { classify } from './classifier.js';

const migration = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../migrations/0066_jev_tags.sql'), 'utf8');
const U1 = '00000000-0000-4000-8000-000000000001';
const U2 = '00000000-0000-4000-8000-000000000002';
const A1 = '00000000-0000-4000-8000-0000000000a1';
const A2 = '00000000-0000-4000-8000-0000000000a2';
const M1 = '00000000-0000-4000-8000-0000000000b1';
const M2 = '00000000-0000-4000-8000-0000000000b2';

// Runs the real 0066 migration and the store's SQL in a throwaway schema of an explicitly supplied database.
describe.skipIf(!process.env.MAILFLOW_TEST_DATABASE_URL)('tags store (PostgreSQL)', () => {
  let db;
  const schema = `tags_test_${process.pid}`;
  beforeAll(async () => {
    db = new pg.Client({ connectionString: process.env.MAILFLOW_TEST_DATABASE_URL });
    await db.connect();
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema}; SET search_path TO ${schema}, public`);
    await db.query(`
      CREATE TABLE users (id uuid PRIMARY KEY);
      CREATE TABLE email_accounts (id uuid PRIMARY KEY, user_id uuid REFERENCES users(id));
      CREATE TABLE messages (id uuid PRIMARY KEY, account_id uuid REFERENCES email_accounts(id), folder text,
        subject text, from_name text, from_email text, snippet text, body_text text, date timestamptz, is_deleted boolean DEFAULT false);
      INSERT INTO users VALUES ('${U1}'), ('${U2}');
      INSERT INTO email_accounts VALUES ('${A1}', '${U1}'), ('${A2}', '${U2}');
      INSERT INTO messages (id, account_id, folder, subject, from_name, from_email, date)
        VALUES ('${M1}', '${A1}', 'INBOX', 'Hello', 'Alex', 'a@x.example', now()),
               ('${M2}', '${A2}', 'INBOX', 'Other user', 'Bob', 'b@x.example', now())`);
    await db.query(migration);
    query.mockImplementation((sql, params) => db.query(sql, params));
  });
  afterAll(async () => {
    await db?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db?.end();
  });

  it('seeds the three default tags once, with one privacy tag', async () => {
    await store.ensureDefaultTags(U1);
    await store.ensureDefaultTags(U1);
    const defs = await store.listDefinitions(U1);
    expect(defs.map((d) => d.key)).toEqual(['private', 'important', 'urgent']);
    expect(defs.filter((d) => d.role === 'privacy')).toHaveLength(1);
    expect(defs[0].true_examples.length).toBeGreaterThan(0);
  });

  it('creates, edits and deletes custom tags but never deletes the privacy tag', async () => {
    const created = await store.createDefinition(U1, { key: 'travel', name: 'Travel', color: '#00aa00', instructions: 'About a trip?', true_examples: ['Your flight'] });
    expect(created.position).toBe(3);
    const edited = await store.updateDefinition(U1, created.id, { name: 'Trips', false_examples: ['Newsletter'], threshold_high: 0.8 });
    expect(edited).toMatchObject({ name: 'Trips', false_examples: ['Newsletter'] });
    expect(Number(edited.threshold_high)).toBe(0.8);
    expect(await store.updateDefinition(U2, created.id, { name: 'hijack' })).toBeNull();
    expect(await store.deleteDefinition(U1, created.id)).toBe(true);
    const privacy = (await store.listDefinitions(U1)).find((d) => d.role === 'privacy');
    expect(await store.deleteDefinition(U1, privacy.id)).toBe(false);
  });

  it('stores the API key encrypted and never in clear', async () => {
    await store.saveSettings(U1, { apiKey: 'secret-key-123', threshold_low: 0.3 });
    const raw = (await db.query('SELECT api_key_enc FROM tag_settings WHERE user_id = $1', [U1])).rows[0].api_key_enc;
    expect(raw).not.toContain('secret-key-123');
    const loaded = await store.loadSettings(U1);
    expect(loaded.apiKey).toBe('secret-key-123');
    expect(loaded.apiKeySource).toBe('ui');
    expect(loaded.threshold_low).toBe(0.3);
    await store.saveSettings(U1, { apiKey: '' });
    expect((await store.loadSettings(U1)).apiKey).toBeNull();
  });

  it('persists Jev answers, keeps manual overrides, and scopes reads to the owner', async () => {
    const defs = await store.listDefinitions(U1);
    const id = Object.fromEntries(defs.map((d) => [d.key, d.id]));
    const ask = async (state, questions) => ({
      scores: Object.fromEntries(Object.keys(questions).map((q) => [q, q === id.important ? 0.9 : 0.1])),
      usage: { input: 50, output: 5 }, model: 'jev-test',
    });
    const message = await store.loadOwnedMessageForTags(U1, M1);
    const outcome = await classify({ message, definitions: defs, settings: await store.loadSettings(U1), ask, today: '2026-10-12' });
    await store.saveClassification(M1, outcome, { model: 'jev-test' });

    let tags = (await store.tagsForMessages(U1, [M1]))[M1];
    expect(tags.map((t) => t.key)).toEqual(['important']);
    expect(tags[0].score).toBe(0.9);
    expect((await store.tagsForMessages(U1, [M1], { all: true }))[M1]).toHaveLength(3);
    expect(await store.runForMessage(U1, M1)).toMatchObject({ status: 'done', body_sent: false, input_tokens: 50 });

    // owner scoping
    expect(await store.tagsForMessages(U2, [M1])).toEqual({});
    expect(await store.runForMessage(U2, M1)).toBeNull();
    expect(await store.loadOwnedMessageForTags(U2, M1)).toBeNull();
    expect(await store.setManualTag(U2, M1, id.urgent, true)).toBe(false);

    // manual pin survives a reclassification
    expect(await store.setManualTag(U1, M1, id.urgent, true)).toBe(true);
    await store.saveClassification(M1, outcome, { model: 'jev-test' });
    tags = (await store.tagsForMessages(U1, [M1]))[M1];
    expect(tags.map((t) => t.key).sort()).toEqual(['important', 'urgent']);
    expect(tags.find((t) => t.key === 'urgent').source).toBe('manual');
  });

  it('lists only unclassified INBOX messages of the given accounts', async () => {
    expect(await store.inboxMessageIdsToClassify([A1], 10)).toEqual([]); // M1 already has a run
    expect(await store.inboxMessageIdsToClassify([A1], 10, { includeClassified: true })).toEqual([M1]);
    expect(await store.inboxMessageIdsToClassify([A2], 10)).toEqual([M2]);
    expect(await store.inboxMessageIdsToClassify([], 10)).toEqual([]);
  });

  it('cascades: deleting a message removes its tags and run', async () => {
    await db.query('DELETE FROM messages WHERE id = $1', [M1]);
    expect((await db.query('SELECT 1 FROM message_tags WHERE message_id = $1', [M1])).rowCount).toBe(0);
    expect((await db.query('SELECT 1 FROM message_tag_runs WHERE message_id = $1', [M1])).rowCount).toBe(0);
  });
});
