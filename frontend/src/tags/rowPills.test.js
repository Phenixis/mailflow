import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// MessageList has two row renderers (ThreadRow and MessageRow). Tag pills were once added to only
// one of them, so most rows showed none; every row that shows the spam badge must show the pills.
test('every message-list row renderer shows the tag pills', () => {
  const source = readFileSync(new URL('../components/MessageList.jsx', import.meta.url), 'utf8');
  const spamBadges = source.match(/<SpamBadge message=\{message\} onClick=\{onExplainSpam\} \/>/g) || [];
  const pills = source.match(/<RowTagPills message=\{message\} \/>/g) || [];
  assert.equal(spamBadges.length, 2, 'two row renderers expected');
  assert.equal(pills.length, spamBadges.length);
});

test('the tag filter bar takes the list background instead of painting its own', () => {
  const source = readFileSync(new URL('./TagFilterBar.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /aria-label[^\n]*background:/);
});
