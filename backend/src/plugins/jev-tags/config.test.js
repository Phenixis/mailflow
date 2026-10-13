import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => new Map());
const api = vi.hoisted(() => ({
  storage: { getValue: vi.fn(), put: vi.fn() },
  encryptSecret: vi.fn((v) => `enc:${Buffer.from(v).toString('base64')}`),
  decryptSecret: vi.fn((v) => Buffer.from(v.replace(/^enc:/, ''), 'base64').toString()),
  listTagDefinitions: vi.fn(),
  ensureTagDefinition: vi.fn(),
}));
vi.mock('../api.js', () => api);

import { loadSettings, saveSettings, loadQuestions, saveQuestion, removeQuestion, ensureDefaults, activeEntries, defaultInstructions } from './config.js';
import { DEFAULT_TAGS } from './defaults.js';

beforeEach(() => {
  db.clear();
  vi.clearAllMocks();
  delete process.env.TYPESAFE_API_KEY;
  api.storage.getValue.mockImplementation(async (_p, key) => (db.has(key) ? { value: db.get(key) } : null));
  api.storage.put.mockImplementation(async (_p, key, { value, ownerId }) => { db.set(key, value); db.set(`owner:${key}`, ownerId); });
});

describe('settings', () => {
  it('stores the API key encrypted, never in clear, and decrypts it for server use', async () => {
    await saveSettings('u1', { apiKey: 'secret-key', threshold_low: 0.3 });
    const stored = db.get('settings:u1');
    expect(JSON.stringify(stored)).not.toContain('secret-key');
    expect(stored.apiKeyEnc).toBe(`enc:${Buffer.from('secret-key').toString('base64')}`);
    expect(db.get('owner:settings:u1')).toBe('u1');
    const loaded = await loadSettings('u1');
    expect(loaded).toMatchObject({ apiKey: 'secret-key', apiKeySource: 'ui', threshold_low: 0.3, threshold_high: 0.65, privacyTagKey: 'private' });
    expect(loaded.apiKeyEnc).toBeUndefined();
  });

  it('clears the key with an empty string, leaves it alone when absent, and falls back to the environment', async () => {
    await saveSettings('u1', { apiKey: 'k' });
    await saveSettings('u1', { model: 'jev-x' });
    expect((await loadSettings('u1')).apiKey).toBe('k');
    await saveSettings('u1', { apiKey: '' });
    expect((await loadSettings('u1')).apiKey).toBeNull();
    process.env.TYPESAFE_API_KEY = 'from-env';
    expect(await loadSettings('u1')).toMatchObject({ apiKey: 'from-env', apiKeySource: 'env', model: 'jev-x' });
  });

  it('trims whitespace around a pasted key', async () => {
    await saveSettings('u1', { apiKey: '  apikey_a_b\n' });
    expect((await loadSettings('u1')).apiKey).toBe('apikey_a_b');
  });

  it('keeps each user\'s settings separate', async () => {
    await saveSettings('u1', { apiKey: 'a' });
    expect((await loadSettings('u2')).apiKey).toBeNull();
  });
});

describe('questions and defaults', () => {
  it('creates the default tags and questions without overwriting an edited question', async () => {
    await saveQuestion('u1', 'urgent', { instructions: 'my own', enabled: true });
    await ensureDefaults('u1');
    expect(api.ensureTagDefinition).toHaveBeenCalledTimes(DEFAULT_TAGS.length);
    expect(api.ensureTagDefinition).toHaveBeenCalledWith('u1', { key: 'private', name: 'Private', color: '#8b5cf6' });
    const q = await loadQuestions('u1');
    expect(Object.keys(q).sort()).toEqual(['important', 'private', 'urgent']);
    expect(q.urgent.instructions).toBe('my own');
    expect(q.private.enabled).toBe(true);
  });

  it('fills in the default question where the user only switched Jev on without writing one', async () => {
    await saveQuestion('u1', 'private', { instructions: '', enabled: true, learn: true, true_examples: [], false_examples: [], true_what: null, false_what: null });
    await saveQuestion('u1', 'important', { instructions: '', enabled: false, learn: false });
    await saveQuestion('u1', 'urgent', { instructions: '', true_examples: ['my own example'], enabled: true });
    await ensureDefaults('u1');
    const q = await loadQuestions('u1');
    expect(q.private.instructions).toMatch(/personal or confidential/); // the real privacy question, not "belongs under the tag"
    expect(q.private.true_examples.length).toBeGreaterThan(0);
    expect(q.private.enabled).toBe(true);
    expect(q.important.enabled).toBe(false); // the user's on/off choice is kept
    expect(q.important.learn).toBe(false);
    expect(q.urgent.instructions).toBe(''); // the user wrote an example: not blank, left alone
    expect(q.urgent.true_examples).toEqual(['my own example']);
  });

  it('removes a question', async () => {
    await saveQuestion('u1', 'travel', { instructions: 'q', enabled: true });
    await removeQuestion('u1', 'travel');
    expect(await loadQuestions('u1')).toEqual({});
  });

  it('asks only about enabled tags that have an enabled question', async () => {
    api.listTagDefinitions.mockResolvedValue([
      { key: 'a', name: 'A', enabled: true }, { key: 'b', name: 'B', enabled: false },
      { key: 'c', name: 'C', enabled: true }, { key: 'd', name: 'D', enabled: true },
    ]);
    await saveQuestion('u1', 'a', { instructions: 'qa', enabled: true });
    await saveQuestion('u1', 'b', { instructions: 'qb', enabled: true });
    await saveQuestion('u1', 'c', { instructions: 'qc', enabled: false });
    expect((await activeEntries('u1')).map((e) => e.key)).toEqual(['a']);
  });

  it('gives a tag switched on without written instructions the default question built from its name', async () => {
    api.listTagDefinitions.mockResolvedValue([{ key: 'travel', name: 'Travel', enabled: true }, { key: 'urgent', name: 'Urgent', enabled: true }]);
    await saveQuestion('u1', 'travel', { instructions: '   ', enabled: true });
    await saveQuestion('u1', 'urgent', { instructions: 'my own question', enabled: true });
    const entries = await activeEntries('u1');
    expect(entries.find((e) => e.key === 'travel').question.instructions).toBe(defaultInstructions('Travel'));
    expect(defaultInstructions('Travel')).toBe('The message belongs under the tag "Travel".');
    expect(entries.find((e) => e.key === 'urgent').question.instructions).toBe('my own question');
  });
});
