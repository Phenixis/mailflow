import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
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
Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, CustomEvent: dom.window.CustomEvent });
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
globalThis.matchMedia = dom.window.matchMedia;
globalThis.__VITE_ENV__ = { MODE: 'test', DEV: false, PROD: true };

const { useStore } = await import('../store/index.js');
const { api } = await import('../utils/api.js');
const { applyTagFilter } = await import('./TagFilterBar.jsx');
const { getTagFilter, setTagFilterState } = await import('./filterState.js');

describe('tag filter', () => {
  beforeEach(() => setTagFilterState({ keys: [], mode: 'any' }));

  it('reloads the list from the first page when the filter changes, and clears it', () => {
    const before = useStore.getState().messagesRefreshToken;
    useStore.setState({ messages: [{ id: 'x' }], messagesOffset: 50, hasMoreMessages: false });
    applyTagFilter({ keys: ['urgent', 'important'], mode: 'all' });
    const s = useStore.getState();
    assert.deepEqual(getTagFilter(), { keys: ['urgent', 'important'], mode: 'all' });
    assert.equal(s.messagesRefreshToken, before + 1);
    assert.deepEqual([s.messages.length, s.messagesOffset, s.hasMoreMessages], [0, 0, true]);
    applyTagFilter({ keys: [] });
    assert.deepEqual(getTagFilter().keys, []);
  });

  it('adds the tags and the mode to every message-list request while a filter is on', async () => {
    const urls = [];
    globalThis.fetch = async (url) => { urls.push(String(url)); return { ok: true, json: async () => ({ messages: [], total: 0 }) }; };
    await api.getMessages({ limit: 5 });
    setTagFilterState({ keys: ['urgent', 'important'], mode: 'all' });
    await api.getMessages({ limit: 5 });
    assert.ok(!urls[0].includes('tag='));
    assert.match(urls[1], /[?&]tag=urgent%2Cimportant/);
    assert.match(urls[1], /[?&]tagMode=all/);
    assert.match(urls[1], /limit=5/);
  });
});
