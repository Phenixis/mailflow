import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getTagFilter, setTagFilterState, subscribeTagFilter } from './filterState.js';

describe('tag filter state', () => {
  beforeEach(() => setTagFilterState({ keys: [], mode: 'any' }));

  it('holds the keys and the mode, and notifies subscribers only on a real change', () => {
    let calls = 0;
    const off = subscribeTagFilter(() => { calls++; });
    setTagFilterState({ keys: ['urgent', 'important'] });
    setTagFilterState({ keys: ['urgent', 'important'] });
    assert.deepEqual(getTagFilter(), { keys: ['urgent', 'important'], mode: 'any' });
    assert.equal(calls, 1);
    setTagFilterState({ mode: 'all' });
    assert.deepEqual(getTagFilter(), { keys: ['urgent', 'important'], mode: 'all' });
    assert.equal(calls, 2);
    off();
    setTagFilterState({ keys: [] });
    assert.equal(calls, 2);
  });

  it('drops duplicate keys and hands out a new snapshot on each change', () => {
    setTagFilterState({ keys: ['a', 'a', 'b'] });
    const first = getTagFilter();
    assert.deepEqual(first.keys, ['a', 'b']);
    setTagFilterState({ keys: ['a'] });
    assert.notEqual(getTagFilter(), first);
  });
});
