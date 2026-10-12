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

// Several screens load the list of tags; each one must reload when the list changes, or a tag
// created in Settings would not show in the filter bar, the pickers or a plugin until a refresh.
test('screens that list the tags depend on the definitions revision', () => {
  for (const file of ['TagFilterBar.jsx', 'TagPickerList.jsx', 'TagsSettings.jsx']) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    assert.match(source, /useTagDefinitionsRevision\(\)/, `${file} reads the revision`);
  }
  const settings = readFileSync(new URL('./TagsSettings.jsx', import.meta.url), 'utf8');
  assert.match(settings, /bumpTagDefinitions\(\)/, 'creating, editing or deleting a tag announces the change');
});

test('the Jev settings reload their tag list when the definitions change', () => {
  const source = readFileSync(new URL('../plugins/jev-tags/JevSettings.jsx', import.meta.url), 'utf8');
  assert.match(source, /useTagDefinitionsRevision\(\)/);
  assert.match(source, /bumpTagDefinitions\(\)/, 'creating the default tags announces them to the other screens');
});
