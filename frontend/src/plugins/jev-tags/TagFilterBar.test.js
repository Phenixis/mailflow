import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
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

import { JSDOM } from 'jsdom';
const dom = new JSDOM('<div id="root"></div>', { url: 'https://mail.example.invalid', pretendToBeVisual: true });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, CustomEvent: dom.window.CustomEvent });
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
globalThis.matchMedia = dom.window.matchMedia;
globalThis.__VITE_ENV__ = { MODE: 'test', DEV: false, PROD: true };

const { useStore } = await import('../../store/index.js');
const { useTagStore } = await import('./tagStore.js');
const { tagListParams, setTagFilter } = await import('./TagFilterBar.jsx');
const { registerListParams, getListParams } = await import('../registry.js');

describe('tag filter', () => {
  beforeEach(() => {
    useTagStore.setState({ activeFilter: null });
    useStore.setState({ enabledPlugins: ['jev-tags'] });
  });

  it('adds no parameter until a filter is chosen, and none when the plugin is deactivated', () => {
    assert.deepEqual(tagListParams(), {});
    useTagStore.setState({ activeFilter: 'urgent' });
    assert.deepEqual(tagListParams(), { tag: 'urgent' });
    useStore.setState({ enabledPlugins: [] });
    assert.deepEqual(tagListParams(), {});
  });

  it('reloads the list from the first page when the filter changes, and clears it', () => {
    const before = useStore.getState().messagesRefreshToken;
    useStore.setState({ messages: [{ id: 'x' }], messagesOffset: 50, hasMoreMessages: false });
    setTagFilter('urgent');
    const s = useStore.getState();
    assert.equal(useTagStore.getState().activeFilter, 'urgent');
    assert.equal(s.messagesRefreshToken, before + 1);
    assert.deepEqual([s.messages.length, s.messagesOffset, s.hasMoreMessages], [0, 0, true]);
    setTagFilter(null);
    assert.equal(useTagStore.getState().activeFilter, null);
  });

  it('merges provider parameters and ignores a provider that throws', () => {
    registerListParams('a', () => ({ x: '1' }));
    registerListParams('b', () => { throw new Error('boom'); });
    assert.equal(getListParams().x, '1');
  });
});
