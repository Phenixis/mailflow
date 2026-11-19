import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getTagFilter, setTagFilterState, subscribeTagFilter } from './filterState.js';

describe('tag filter state', () => {
  beforeEach(() => setTagFilterState({ ids: [], mode: 'any' }));

  it('holds the ids and the mode, and notifies subscribers only on a real change', () => {
    let calls = 0;
    const off = subscribeTagFilter(() => { calls++; });
    setTagFilterState({ ids: ['urgent', 'important'] });
    setTagFilterState({ ids: ['urgent', 'important'] });
    assert.deepEqual(getTagFilter(), { ids: ['urgent', 'important'], mode: 'any' });
    assert.equal(calls, 1);
    setTagFilterState({ mode: 'all' });
    assert.deepEqual(getTagFilter(), { ids: ['urgent', 'important'], mode: 'all' });
    assert.equal(calls, 2);
    off();
    setTagFilterState({ ids: [] });
    assert.equal(calls, 2);
  });

  it('drops duplicate ids and hands out a new snapshot on each change', () => {
    setTagFilterState({ ids: ['a', 'a', 'b'] });
    const first = getTagFilter();
    assert.deepEqual(first.ids, ['a', 'b']);
    setTagFilterState({ ids: ['a'] });
    assert.notEqual(getTagFilter(), first);
  });
});
