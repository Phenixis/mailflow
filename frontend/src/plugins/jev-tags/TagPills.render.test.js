import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { transform } from 'sucrase';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.jsx')) {
      const out = transform(readFileSync(new URL(url), 'utf8'), { transforms: ['jsx'], jsxRuntime: 'automatic', filePath: url });
      return { format: 'module', shortCircuit: true, source: out.code };
    }
    return nextLoad(url, context);
  },
});

const { Pill } = await import('./TagPills.jsx');
const { translate } = await import('./strings.js');

const tEn = (key, vars) => translate('en', key, vars);
const tFr = (key, vars) => translate('fr-FR', key, vars);
const jev = { tagId: 't1', name: 'Urgent', color: '#ef4444', score: 0.81, applied: true, source: 'jev', bodySent: false };

test('Pill shows the tag name and a tooltip with the score and what was sent', () => {
  const html = renderToStaticMarkup(createElement(Pill, { tag: jev, t: tEn, small: true }));
  assert.match(html, />Urgent</);
  assert.match(html, /title="Urgent \(0\.81\): subject only"/);
  assert.match(renderToStaticMarkup(createElement(Pill, { tag: { ...jev, bodySent: true }, t: tEn })), /subject \+ body excerpt/);
  assert.match(renderToStaticMarkup(createElement(Pill, { tag: { ...jev, score: null, source: 'manual' }, t: tEn })), /title="Urgent: set by hand"/);
});

test('Pill tooltip follows the UI language', () => {
  assert.match(renderToStaticMarkup(createElement(Pill, { tag: jev, t: tFr })), /objet seulement/);
});
