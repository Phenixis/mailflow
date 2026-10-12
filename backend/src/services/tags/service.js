// Orchestration: load a message and the user's tag setup, call Jev, persist the answers.
import { askJev, JevError } from './jevClient.js';
import { classify } from './classifier.js';
import {
  listDefinitions, loadSettings, loadOwnedMessageForTags, saveClassification, saveRun,
} from './store.js';
import { logger } from '../logger.js';
import { getMailEngine } from '../../plugins/mailEngine.js';

// Tell the user's open tabs that these messages' tags changed. Never fails the classification:
// the engine is absent in unit tests and a broadcast blip must not turn a stored result into an error.
function notifyTagsChanged(userId, messageIds) {
  try { getMailEngine().broadcast({ type: 'tags_updated', messageIds }, userId); } catch { /* best effort */ }
}

export async function classifyMessage(userId, messageId, { askImpl = askJev, today = new Date().toISOString().slice(0, 10) } = {}) {
  const message = await loadOwnedMessageForTags(userId, messageId);
  if (!message) return { status: 'missing' };
  const [definitions, settings] = await Promise.all([listDefinitions(userId), loadSettings(userId)]);
  if (!settings.apiKey) return { status: 'no-key' };
  try {
    const outcome = await classify({
      message, definitions, settings, today,
      ask: (state, questions) => askImpl({ apiKey: settings.apiKey, model: settings.model, state, questions }),
    });
    await saveClassification(messageId, outcome, { model: outcome.model });
    notifyTagsChanged(userId, [messageId]);
    return { status: 'done', outcome };
  } catch (err) {
    // The JevError message is already free of request content; anything else is reduced to its name.
    const text = err instanceof JevError ? err.message : `Unexpected error: ${err.name}`;
    logger.warn(`Tag classification failed for message ${messageId}: ${text}`);
    try { await saveRun(messageId, { status: 'error', error: text, model: settings.model }); } catch { /* the failure is already logged */ }
    return { status: 'error', error: text };
  }
}
