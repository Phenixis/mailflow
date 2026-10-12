import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { translate } from './strings.js';

// Every key the components pass to t(): found by scanning the sources, so a typo or a missing
// translation fails here instead of rendering the raw key.
const sources = ['TagPills.jsx', 'TagFilterBar.jsx', 'TagsSettings.jsx', 'TagPickerList.jsx', 'TagMenu.jsx', 'TagBulkButton.jsx', 'TagPickerPopup.jsx'].map((f) => readFileSync(new URL(f, import.meta.url), 'utf8')).join('\n');
const used = new Set([...sources.matchAll(/\bt\(\s*'([a-z]+\.[A-Za-z]+)'/g)].map((m) => m[1]));

describe('tag strings', () => {
  it('has an English and a French text for every key the UI uses', () => {
    assert.ok(used.size > 20);
    for (const key of used) {
      assert.notEqual(translate('en', key), key, `missing en: ${key}`);
      assert.notEqual(translate('fr', key), key, `missing fr: ${key}`);
    }
  });

  it('interpolates variables and falls back to English for other languages', () => {
    assert.equal(translate('en', 'source.auto', { source: 'x' }), 'added by x');
    assert.equal(translate('fr-FR', 'settings.confirmDelete', { name: 'A' }), 'Supprimer le tag « A » et le retirer de tous les messages ?');
    assert.equal(translate('de', 'settings.save'), 'Save');
  });
});
