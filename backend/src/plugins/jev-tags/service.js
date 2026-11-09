// Orchestration: load a message and the user's setup, ask Jev, put or take back the tags, and keep
// Jev's answers on the message so the UI can explain every tag.
import {
  loadOwnedMessage, applyTag, removeTag, setMessageAnnotation, ensureMessageBody, logger,
} from '../api.js';
import { askJev, JevError } from './jevClient.js';
import { classify } from './classifier.js';
import { loadSettings, activeEntries } from './config.js';
import { withLearnedExamples } from './examples.js';
import { PLUGIN_ID } from './defaults.js';

const nowIso = () => new Date().toISOString();

async function saveRun(message, run, answers) {
  await setMessageAnnotation(message.account_id, message.id, PLUGIN_ID, answers ? { run, answers } : { run });
}

export async function classifyMessage(userId, messageId, { askImpl = askJev, today = nowIso().slice(0, 10) } = {}) {
  const message = await loadOwnedMessage(userId, messageId);
  if (!message) return { status: 'missing' };
  const [entries, settings] = await Promise.all([activeEntries(userId), loadSettings(userId)]);
  if (!settings.apiKey) return { status: 'no-key' };
  if (!entries.length) return { status: 'no-tags' };
  try {
    const outcome = await classify({
      message, entries: await withLearnedExamples(userId, entries), privacyKey: settings.privacyTagKey, settings, today,
      // Gmail keeps only the envelope when mail arrives: fetch the body when a second look needs it.
      loadBody: async () => {
        await ensureMessageBody(userId, messageId);
        return loadOwnedMessage(userId, messageId);
      },
      ask: (state, questions) => askImpl({ apiKey: settings.apiKey, model: settings.model, state, questions }),
    });
    const answers = {};
    for (const r of outcome.results) {
      answers[r.tag.key] = { score: typeof r.score === 'number' ? r.score : null, applied: r.applied, pass: r.pass, bodySent: r.bodySent };
      if (r.applied) await applyTag(PLUGIN_ID, userId, messageId, r.tag.key);
      else await removeTag(PLUGIN_ID, userId, messageId, r.tag.key);
    }
    await saveRun(message, {
      status: 'done', pass: outcome.pass, bodySent: outcome.bodySent, bodyMissing: outcome.bodyMissing, isPrivate: outcome.isPrivate,
      model: outcome.model, input: outcome.usage.input, output: outcome.usage.output, at: nowIso(),
    }, answers);
    return { status: 'done', outcome };
  } catch (err) {
    // The JevError message is already free of request content; anything else is reduced to its name.
    const text = err instanceof JevError ? err.message : `Unexpected error: ${err.name}`;
    logger.warn(`Jev classification failed for message ${messageId}: ${text}`);
    try { await saveRun(message, { status: 'error', error: text, model: settings.model, at: nowIso() }); } catch { /* already logged */ }
    return { status: 'error', error: text };
  }
}
