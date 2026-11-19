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
const { HeaderTags } = await import('./TagPills.jsx');

api.tagDefinitions = async () => [{ id: 't1', key: 'urgent', name: 'Urgent', color: '#ef4444' }];
api.tagsForMessages = async () => ({ m1: [{ tagId: 't1', key: 'urgent', name: 'Urgent', color: '#ef4444', source: 'manual' }] });

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

// Regression: HeaderTags passed `messageId` to a picker that takes `messageIds`, so opening the editor in
// the reading pane crashed with "can't access property length, e is undefined".
test('the reading-pane tag editor opens and lists the user\'s tags', async () => {
  const container = document.getElementById('root');
  const root = createRoot(container);
  await React.act(async () => { root.render(React.createElement('div', null, React.createElement(HeaderTags, { message: { id: 'm1' } }))); });
  await React.act(async () => { await tick(); });
  const button = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Tags');
  assert.ok(button, 'the Tags button is there');
  await React.act(async () => { button.click(); });
  await React.act(async () => { await tick(); });
  assert.match(container.textContent, /Urgent/);
  assert.ok(container.querySelector('input[type="checkbox"]'), 'a checkbox per tag');
  await React.act(async () => { root.unmount(); });
});
