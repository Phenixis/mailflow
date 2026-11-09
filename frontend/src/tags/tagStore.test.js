import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../utils/api.js';
import { useTagStore, requestTags, invalidateTags, clearTagCache, countTags, bumpTagDefinitions } from './tagStore.js';

const wait = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const tag = (key) => ({ tagId: `t-${key}`, key, name: key, color: '#000000', source: 'manual' });

describe('tag cache', () => {
  let calls;
  beforeEach(() => {
    clearTagCache();
    calls = [];
    api.tagsForMessages = async (ids) => { calls.push([...ids]); return { a: [tag('urgent')] }; };
  });

  it('batches lookups made in the same tick into one request and caches empty results', async () => {
    requestTags('a'); requestTags('b'); requestTags('a');
    await wait();
    assert.deepEqual(calls, [['a', 'b']]);
    const { byMessage } = useTagStore.getState();
    assert.equal(byMessage.a[0].key, 'urgent');
    assert.deepEqual(byMessage.b, []);
    requestTags('a');
    await wait();
    assert.equal(calls.length, 1, 'cached ids are not requested again');
  });

  it('refetches when invalidated', async () => {
    requestTags('a');
    await wait();
    invalidateTags(['a']);
    await wait();
    assert.equal(calls.length, 2);
  });

  it('keeps ids unknown when the request fails, so the next render retries', async () => {
    api.tagsForMessages = async () => { throw new Error('offline'); };
    requestTags('x');
    await wait();
    assert.equal(useTagStore.getState().byMessage.x, undefined);
    api.tagsForMessages = async (ids) => { calls.push([...ids]); return {}; };
    requestTags('x');
    await wait();
    assert.deepEqual(useTagStore.getState().byMessage.x, []);
  });
});

describe('countTags', () => {
  it('counts how many of the given messages carry each tag, ignoring messages not loaded yet', () => {
    const byMessage = { a: [{ tagId: 't1' }, { tagId: 't2' }], b: [{ tagId: 't1' }], c: [] };
    assert.deepEqual(countTags(['a', 'b', 'c', 'unknown'], byMessage), { t1: 2, t2: 1 });
    assert.deepEqual(countTags([], byMessage), {});
  });
});

describe('tag definitions revision', () => {
  it('increases on every announced change, and clearing the message cache keeps it', () => {
    const before = useTagStore.getState().definitionsRevision;
    bumpTagDefinitions();
    bumpTagDefinitions();
    assert.equal(useTagStore.getState().definitionsRevision, before + 2);
    clearTagCache();
    assert.equal(useTagStore.getState().definitionsRevision, before + 2);
  });
});
