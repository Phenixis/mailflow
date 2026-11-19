// Make sure a message's body is cached, fetching it from the mail server the way opening the message does.
// Some providers (Gmail) store only the envelope when mail arrives and fetch the body when it is opened, so a
// plugin that needs the text of a new message (to look at it a second time) has to ask for it.
import { query } from './db.js';
import { sanitizeEmail } from './emailSanitizer.js';
import { snippetFromBody } from './messageParser.js';

const DEFAULT_TIMEOUT_MS = 20_000;

// Postgres text cannot hold NUL bytes.
const clean = (value) => (typeof value === 'string' ? value.replace(/\0/g, '') : value);

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('BODY_FETCH_TIMEOUT')), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Resolves to 'cached' (already there), 'fetched', 'empty' (the server returned no text), 'missing' (not the
// user's message) or 'failed' (the server could not be reached in time). Never throws.
export async function ensureMessageBody(engine, userId, messageId, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const { rows } = await query(
    `SELECT m.id, m.uid, m.folder, m.account_id, (m.body_html IS NOT NULL OR m.body_text IS NOT NULL) AS cached
       FROM messages m JOIN email_accounts a ON a.id = m.account_id
      WHERE m.id = $1 AND a.user_id = $2`,
    [messageId, userId]
  );
  const message = rows[0];
  if (!message) return 'missing';
  if (message.cached) return 'cached';
  try {
    const account = (await query('SELECT * FROM email_accounts WHERE id = $1', [message.account_id])).rows[0];
    const { html, text, attachments } = await withTimeout(engine.fetchMessageBody(account, message.uid, message.folder), timeoutMs);
    const safeHtml = html ? clean(sanitizeEmail(html)) : null;
    const safeText = clean(text);
    if (!safeHtml && !safeText) return 'empty';
    const snippet = clean(snippetFromBody(safeText, safeHtml || html));
    await query(
      `UPDATE messages
          SET body_html = $1, body_text = $2, attachments = $3,
              snippet = CASE WHEN $5 != '' THEN $5 ELSE snippet END
        WHERE id = $4`,
      [safeHtml, safeText, JSON.stringify(attachments || []), messageId, snippet]
    );
    return 'fetched';
  } catch {
    return 'failed';
  }
}
