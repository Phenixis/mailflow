// Outbound HTTP for plugins (v3.0 plugin platform). A plugin never holds the network: it asks core to
// make a request, and core makes it only to the HTTPS hosts the plugin declared in its manifest
// (`network: { hosts: ['api.example.com'] }`), through the SSRF-safe fetch, with no redirects, a
// timeout and a response size cap.
import { pluginRegistry } from './registry.js';
import { safeFetch } from '../services/safeFetch.js';
import { readLimited } from '../services/aiHttp.js';

const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_TIMEOUT_MS = 60_000;

export class PluginNetworkError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PluginNetworkError';
  }
}

// Resolves to { status, ok, text }. Rejects with PluginNetworkError when the request is not allowed,
// and with the underlying error (never containing the request body) when the network fails.
export async function httpRequest(pluginId, { url, method = 'POST', headers = {}, body, timeoutMs = 30_000 }, registry = pluginRegistry) {
  const hosts = registry.get(pluginId)?.network?.hosts;
  if (!Array.isArray(hosts) || !hosts.length) throw new PluginNetworkError(`Plugin "${pluginId}" has not declared any network host`);
  let parsed;
  try { parsed = new URL(url); } catch { throw new PluginNetworkError('Invalid URL'); }
  if (parsed.protocol !== 'https:') throw new PluginNetworkError('Only HTTPS is allowed');
  if (!hosts.includes(parsed.hostname)) throw new PluginNetworkError(`Host "${parsed.hostname}" is not declared by plugin "${pluginId}"`);
  if (body !== undefined && typeof body !== 'string') throw new PluginNetworkError('body must be a string');

  const res = await safeFetch(url, {
    method, headers, body, redirect: 'error',
    signal: AbortSignal.timeout(Math.min(timeoutMs, MAX_TIMEOUT_MS)),
  });
  return { status: res.status, ok: res.ok, text: await readLimited(res, MAX_RESPONSE_BYTES) };
}
