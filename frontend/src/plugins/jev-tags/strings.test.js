import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { translate } from './strings.js';

// Every key the components pass to t(): found by scanning the sources, so a typo or a missing
// translation fails here instead of rendering the raw key.
const sources = ['JevWhy.jsx', 'JevSettings.jsx'].map((f) => readFileSync(new URL(f, import.meta.url), 'utf8')).join('\n');
const used = new Set([...sources.matchAll(/\bt\(\s*'([a-z]+\.[A-Za-z]+)'/g)].map((m) => m[1]));
for (const m of sources.matchAll(/'((?:conn|acc|q|why)\.[A-Za-z]+)'/g)) used.add(m[1]);

describe('jev-tags strings', () => {
  it('has an English and a French text for every key the UI uses', () => {
    assert.ok(used.size > 30);
    for (const key of used) {
      assert.notEqual(translate('en', key), key, `missing en: ${key}`);
      assert.notEqual(translate('fr', key), key, `missing fr: ${key}`);
    }
  });

  it('interpolates variables and falls back to English for other languages', () => {
    assert.equal(translate('en', 'acc.queued', { n: 3, a: 1 }), '3 message(s) queued (1 account(s) enabled)');
    assert.equal(translate('fr-FR', 'why.runTokens', { n: 12 }), '12 tokens');
    assert.equal(translate('de', 'q.save'), 'Save question');
  });
});
