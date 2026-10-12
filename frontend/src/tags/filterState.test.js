import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getTagFilter, setTagFilterValue, subscribeTagFilter } from './filterState.js';

describe('tag filter state', () => {
  beforeEach(() => setTagFilterValue(null));

  it('holds the active key and notifies subscribers only on a real change', () => {
    let calls = 0;
    const off = subscribeTagFilter(() => { calls++; });
    setTagFilterValue('urgent');
    setTagFilterValue('urgent');
    assert.equal(getTagFilter(), 'urgent');
    assert.equal(calls, 1);
    off();
    setTagFilterValue(null);
    assert.equal(calls, 1);
  });
});
