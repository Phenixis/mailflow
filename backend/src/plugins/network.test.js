import { describe, it, expect, vi, beforeEach } from 'vitest';

const safeFetch = vi.hoisted(() => vi.fn());
vi.mock('../services/safeFetch.js', () => ({ safeFetch }));
import { httpRequest, PluginNetworkError } from './network.js';

const registry = { get: (id) => (id === 'p' ? { network: { hosts: ['api.example.com'] } } : id === 'none' ? {} : undefined) };
const ok = (text) => ({ status: 200, ok: true, body: new Response(text).body });

beforeEach(() => { safeFetch.mockReset(); });

describe('plugin httpRequest', () => {
  it('calls a declared HTTPS host without following redirects and returns the text', async () => {
    safeFetch.mockResolvedValue(ok('{"a":1}'));
    const out = await httpRequest('p', { url: 'https://api.example.com/v1/x', body: '{}', headers: { Authorization: 'Bearer k' } }, registry);
    expect(out).toEqual({ status: 200, ok: true, text: '{"a":1}' });
    const [url, init] = safeFetch.mock.calls[0];
    expect(url).toBe('https://api.example.com/v1/x');
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', body: '{}' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('refuses undeclared hosts, plain HTTP, bad URLs, a plugin with no hosts, and non-string bodies', async () => {
    const call = (id, url, extra = {}) => httpRequest(id, { url, ...extra }, registry);
    await expect(call('p', 'https://evil.example.org/')).rejects.toThrow('not declared');
    await expect(call('p', 'https://api.example.com.evil.org/')).rejects.toThrow('not declared');
    await expect(call('p', 'http://api.example.com/')).rejects.toThrow('Only HTTPS');
    await expect(call('p', 'not a url')).rejects.toThrow('Invalid URL');
    await expect(call('none', 'https://api.example.com/')).rejects.toBeInstanceOf(PluginNetworkError);
    await expect(call('ghost', 'https://api.example.com/')).rejects.toBeInstanceOf(PluginNetworkError);
    await expect(call('p', 'https://api.example.com/', { body: { a: 1 } })).rejects.toThrow('body must be a string');
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it('caps the response size', async () => {
    safeFetch.mockResolvedValue(ok('x'.repeat(600 * 1024)));
    const out = await httpRequest('p', { url: 'https://api.example.com/' }, registry);
    expect(out.text.length).toBe(512 * 1024);
  });
});
