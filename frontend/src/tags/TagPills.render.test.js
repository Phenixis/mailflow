import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { JSDOM } from 'jsdom';
import { transform } from 'sucrase';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('react-i18next/dist/es/index.js') || url.endsWith('/react-i18next')) {
      return { format: 'module', shortCircuit: true, source: [
        'export const useTranslation = () => ({ t: (k) => k, i18n: { language: "en", changeLanguage: () => {} } });',
        'export const initReactI18next = { type: "3rdParty", init: () => {} };',
        'export default { useTranslation, initReactI18next };',
      ].join('\n') };
    }
    if (url.endsWith('.json')) {
      return { format: 'module', shortCircuit: true, source: `export default ${readFileSync(new URL(url), 'utf8')}` };
    }
    const shimViteEnv = (code) => code.replaceAll('import.meta.env', 'globalThis.__VITE_ENV__');
    if (url.endsWith('.jsx')) {
      const out = transform(readFileSync(new URL(url), 'utf8'), { transforms: ['jsx'], jsxRuntime: 'automatic', filePath: url });
      return { format: 'module', shortCircuit: true, source: shimViteEnv(out.code) };
    }
    if (url.startsWith('file:') && url.endsWith('.js')) {
      const code = readFileSync(new URL(url), 'utf8');
      if (code.includes('import.meta.env')) return { format: 'module', shortCircuit: true, source: shimViteEnv(code) };
    }
    return nextLoad(url, context);
  },
});
const dom = new JSDOM('<div id="root"></div>', { url: 'https://mail.example.invalid', pretendToBeVisual: true });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, CustomEvent: dom.window.CustomEvent });
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
globalThis.matchMedia = dom.window.matchMedia;
globalThis.__VITE_ENV__ = { MODE: 'test', DEV: false, PROD: true };

const { Pill } = await import('./TagPills.jsx');
const { translate } = await import('./strings.js');
const tEn = (key, vars) => translate('en', key, vars);
const tFr = (key, vars) => translate('fr-FR', key, vars);

test('Pill shows the name and says whether the tag was set by hand or by a plugin', () => {
  const manual = renderToStaticMarkup(createElement(Pill, { tag: { tagId: 't', name: 'Urgent', color: '#ef4444', source: 'manual' }, t: tEn, small: true }));
  assert.match(manual, />Urgent</);
  assert.match(manual, /title="Urgent: set by hand"/);
  const auto = renderToStaticMarkup(createElement(Pill, { tag: { tagId: 't', name: 'Urgent', color: '#ef4444', source: 'jev-tags' }, t: tEn }));
  assert.match(auto, /title="Urgent: added by jev-tags"/);
});

test('Pill tooltip follows the UI language', () => {
  assert.match(renderToStaticMarkup(createElement(Pill, { tag: { tagId: 't', name: 'Urgent', color: '#ef4444', source: 'manual' }, t: tFr })), /défini à la main/);
});
