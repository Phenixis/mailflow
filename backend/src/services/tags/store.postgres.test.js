import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

vi.mock('../db.js', () => ({ query: vi.fn() }));
import { query } from '../db.js';
import * as store from './store.js';

const migration = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../migrations/0066_tags.sql'), 'utf8');
const U1 = '00000000-0000-4000-8000-000000000001';
const U2 = '00000000-0000-4000-8000-000000000002';
const A1 = '00000000-0000-4000-8000-0000000000a1';
const A2 = '00000000-0000-4000-8000-0000000000a2';
const M1 = '00000000-0000-4000-8000-0000000000b1';
const M2 = '00000000-0000-4000-8000-0000000000b2';

// Runs the real 0066 migration and the store's SQL in a throwaway schema of an explicitly supplied database.
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
      CREATE TABLE messages (id uuid PRIMARY KEY, account_id uuid REFERENCES email_accounts(id), folder text,
        date timestamptz, is_deleted boolean DEFAULT false, plugin_annotations jsonb NOT NULL DEFAULT '{}');
      INSERT INTO users VALUES ('${U1}'), ('${U2}');
      INSERT INTO email_accounts VALUES ('${A1}', '${U1}'), ('${A2}', '${U2}');
      INSERT INTO messages (id, account_id, folder, date) VALUES ('${M1}', '${A1}', 'INBOX', now()), ('${M2}', '${A2}', 'INBOX', now())`);
    await db.query(migration);
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

  it('lists INBOX messages, optionally only those a plugin has not annotated', async () => {
    expect(await store.listInboxMessageIds(U1, [A1], 10)).toEqual([M1]);
    expect(await store.listInboxMessageIds(U1, [A2], 10)).toEqual([]); // not the user's account
    expect(await store.listInboxMessageIds(U1, [], 10)).toEqual([]);
    expect(await store.listInboxMessageIds(U1, [A1], 10, { withoutAnnotation: 'jev-tags' })).toEqual([M1]);
    await db.query(`UPDATE messages SET plugin_annotations = '{"jev-tags": {"run": {}}}' WHERE id = '${M1}'`);
    expect(await store.listInboxMessageIds(U1, [A1], 10, { withoutAnnotation: 'jev-tags' })).toEqual([]);
    expect(await store.listInboxMessageIds(U1, [A1], 10)).toEqual([M1]);
  });

  it('cascades: deleting a message or a tag removes the links', async () => {
    await db.query('DELETE FROM messages WHERE id = $1', [M2]);
    expect((await db.query('SELECT 1 FROM message_tags WHERE message_id = $1', [M2])).rowCount).toBe(0);
    const urgent = (await store.listDefinitions(U1)).find((d) => d.key === 'urgent');
    await store.deleteDefinition(U1, urgent.id);
    expect((await db.query('SELECT 1 FROM message_tags WHERE tag_id = $1', [urgent.id])).rowCount).toBe(0);
  });
});
