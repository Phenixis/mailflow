import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { JSDOM } from 'jsdom';
import { transform } from 'sucrase';
import { reactI18nextMockSource } from './i18nTestSupport.js';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('react-i18next/dist/es/index.js') || url.endsWith('/react-i18next')) {
      return { format: 'module', shortCircuit: true, source: reactI18nextMockSource() };
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
dom.window.innerWidth = 390; // a phone
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, CustomEvent: dom.window.CustomEvent,
  Node: dom.window.Node, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true,
});
dom.window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
globalThis.matchMedia = dom.window.matchMedia;
globalThis.__VITE_ENV__ = { MODE: 'test', DEV: false, PROD: true };

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { api } = await import('../utils/api.js');
const TagBulkButton = (await import('./TagBulkButton.jsx')).default;

api.tagDefinitions = async () => [{ id: 't1', key: 'urgent', name: 'Urgent', color: '#ef4444', enabled: true }];
api.tagsForMessages = async () => ({});

const Btn = ({ children, onClick, title }) => React.createElement('button', { onClick, title, id: 'bulk-tag' }, children);
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

test('on a phone the bulk tag picker is a bottom sheet on <body>, above the compose button and below dialogs', async () => {
  const container = document.getElementById('root');
  const root = createRoot(container);
  await React.act(async () => { root.render(React.createElement(TagBulkButton, { ids: ['m1', 'm2'], Btn })); });
  assert.equal(document.querySelector('[role="dialog"]'), null);

  await React.act(async () => { document.getElementById('bulk-tag').click(); });
  await React.act(async () => { await tick(); });

  const sheet = document.querySelector('[role="dialog"]');
  assert.ok(sheet, 'the sheet opens');
  assert.equal(container.contains(sheet), false, 'it is not inside the toolbar, whose stacking context sits under the compose button');
  assert.equal(sheet.parentElement, document.body);
  const z = Number(sheet.style.zIndex);
  assert.ok(z > 200, 'above the compose button (200)');
  assert.ok(z < 4000, 'below the dialogs and the context menu');
  assert.match(sheet.textContent, /Urgent/);
  assert.match(sheet.textContent, /0 of 2/); // how many of the selected messages carry the tag

  await React.act(async () => { root.unmount(); });
});
