import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { translate } from './strings.js';

// Every key the components pass to t(): found by scanning the sources, so a typo or a missing
// translation fails here instead of rendering the raw key.
const sources = ['TagPills.jsx', 'JevTagsSettings.jsx'].map((f) => readFileSync(new URL(f, import.meta.url), 'utf8')).join('\n');
const used = new Set([...sources.matchAll(/\bt\(\s*'([a-z]+\.[A-Za-z]+)'/g)].map((m) => m[1]));
for (const m of sources.matchAll(/'((?:conn|tags|header|acc|source|settings|pill)\.[A-Za-z]+)'/g)) used.add(m[1]);

describe('jev-tags strings', () => {
  it('has an English and a French text for every key the UI uses', () => {
    assert.ok(used.size > 40);
    for (const key of used) {
      assert.notEqual(translate('en', key), key, `missing en: ${key}`);
      assert.notEqual(translate('fr', key), key, `missing fr: ${key}`);
    }
  });

  it('interpolates variables and falls back to English for other languages', () => {
    assert.equal(translate('en', 'tags.confirmDelete', { name: 'X' }), 'Delete the tag "X" and its history?');
    assert.equal(translate('fr-FR', 'acc.queued', { n: 3, a: 1 }), '3 message(s) en file (1 compte(s) activé(s))');
    assert.equal(translate('de', 'tags.save'), 'Save tag');
    assert.equal(translate(undefined, 'tags.save'), 'Save tag');
  });
});
