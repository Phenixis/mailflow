import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./db.js', () => ({ query: vi.fn() }));
vi.mock('./emailSanitizer.js', () => ({ sanitizeEmail: (h) => h.replace(/<script.*?<\/script>/g, '') }));
vi.mock('./messageParser.js', () => ({ snippetFromBody: (t) => (t || '').slice(0, 20) }));
import { query } from './db.js';
import { ensureMessageBody } from './messageBody.js';

const row = (cached) => ({ rows: [{ id: 'm1', uid: 7, folder: 'INBOX', account_id: 'a1', cached }] });
const engine = (impl) => ({ fetchMessageBody: vi.fn(impl) });

beforeEach(() => { query.mockReset(); });

describe('ensureMessageBody', () => {
  it('does nothing for a message that is not the user\'s or whose body is cached', async () => {
    const e = engine(async () => ({}));
    query.mockResolvedValueOnce({ rows: [] });
    expect(await ensureMessageBody(e, 'u1', 'm1')).toBe('missing');
    query.mockResolvedValueOnce(row(true));
    expect(await ensureMessageBody(e, 'u1', 'm1')).toBe('cached');
    expect(e.fetchMessageBody).not.toHaveBeenCalled();
  });

  it('fetches the body like opening the message, sanitizes it and stores it with a snippet', async () => {
    const e = engine(async () => ({ html: '<p>Hello</p><script>x</script>', text: 'Hello\0 there, this is long', attachments: [] }));
    query.mockResolvedValueOnce(row(false)).mockResolvedValueOnce({ rows: [{ id: 'a1' }] }).mockResolvedValueOnce({ rowCount: 1 });
    expect(await ensureMessageBody(e, 'u1', 'm1')).toBe('fetched');
    expect(e.fetchMessageBody).toHaveBeenCalledWith({ id: 'a1' }, 7, 'INBOX');
    const [sql, params] = query.mock.calls[2];
    expect(sql).toContain('UPDATE messages');
    expect(params[0]).toBe('<p>Hello</p>'); // sanitized html
    expect(params[1]).toBe('Hello there, this is long'); // NUL removed
    expect(params[3]).toBe('m1');
    expect(params[4]).toBe('Hello there, this is');
  });

  it('reports an empty fetch and a failure without throwing, and never stores nothing', async () => {
    query.mockResolvedValueOnce(row(false)).mockResolvedValueOnce({ rows: [{ id: 'a1' }] });
    expect(await ensureMessageBody(engine(async () => ({ html: null, text: null })), 'u1', 'm1')).toBe('empty');
    expect(query).toHaveBeenCalledTimes(2); // no UPDATE
    query.mockReset();
    query.mockResolvedValueOnce(row(false)).mockResolvedValueOnce({ rows: [{ id: 'a1' }] });
    expect(await ensureMessageBody(engine(async () => { throw new Error('THROTTLED'); }), 'u1', 'm1')).toBe('failed');
  });

  it('gives up after the timeout', async () => {
    query.mockResolvedValueOnce(row(false)).mockResolvedValueOnce({ rows: [{ id: 'a1' }] });
    const slow = engine(() => new Promise(() => {}));
    expect(await ensureMessageBody(slow, 'u1', 'm1', { timeoutMs: 20 })).toBe('failed');
  });
});
