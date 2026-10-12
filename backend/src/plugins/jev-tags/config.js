// The plugin's per-user configuration, kept in the generic plugin storage (plugin_data): the Jev
// settings (API key encrypted) and, per tag key, the yes/no question Jev answers for that tag.
import { storage, encryptSecret, decryptSecret, listTagDefinitions, ensureTagDefinition } from '../api.js';
import { PLUGIN_ID, DEFAULT_SETTINGS, DEFAULT_TAGS } from './defaults.js';

const settingsKey = (userId) => `settings:${userId}`;
const questionsKey = (userId) => `questions:${userId}`;

async function readValue(key) {
  return (await storage.getValue(PLUGIN_ID, key))?.value ?? {};
}

// Settings with the API key decrypted for server-side use only; routes expose just `hasApiKey`.
export async function loadSettings(userId) {
  const stored = await readValue(settingsKey(userId));
  const fromUi = stored.apiKeyEnc ? decryptSecret(stored.apiKeyEnc) : null;
  const apiKey = fromUi || process.env.TYPESAFE_API_KEY || null;
  const rest = { ...stored };
  delete rest.apiKeyEnc;
  return { ...DEFAULT_SETTINGS, ...rest, apiKey, apiKeySource: fromUi ? 'ui' : (process.env.TYPESAFE_API_KEY ? 'env' : null) };
}

// `patch.apiKey`: a string sets it, '' or null clears it, undefined leaves it alone.
export async function saveSettings(userId, patch) {
  const stored = await readValue(settingsKey(userId));
  const next = { ...stored };
  for (const field of ['threshold_low', 'threshold_high', 'private_above', 'max_body_chars', 'model', 'privacyTagKey']) {
    if (patch[field] !== undefined) next[field] = patch[field];
  }
  if (patch.apiKey !== undefined) {
    if (patch.apiKey) next.apiKeyEnc = encryptSecret(patch.apiKey);
    else delete next.apiKeyEnc;
  }
  await storage.put(PLUGIN_ID, settingsKey(userId), { value: next, ownerId: userId });
}

export const loadQuestions = (userId) => readValue(questionsKey(userId));

export async function saveQuestion(userId, tagKey, question) {
  const all = await loadQuestions(userId);
  await storage.put(PLUGIN_ID, questionsKey(userId), { value: { ...all, [tagKey]: question }, ownerId: userId });
}

export async function removeQuestion(userId, tagKey) {
  const rest = { ...(await loadQuestions(userId)) };
  delete rest[tagKey];
  await storage.put(PLUGIN_ID, questionsKey(userId), { value: rest, ownerId: userId });
}

// Create Private / Important / Urgent as tags (when missing) and give each its default question
// (when it has none). Never overwrites a question the user edited.
export async function ensureDefaults(userId) {
  const all = await loadQuestions(userId);
  for (const t of DEFAULT_TAGS) {
    await ensureTagDefinition(userId, { key: t.key, name: t.name, color: t.color });
    if (!all[t.key]) all[t.key] = { ...t.question, enabled: true };
  }
  await storage.put(PLUGIN_ID, questionsKey(userId), { value: all, ownerId: userId });
}

// The tags to ask Jev about: the user's tags (enabled) that have an enabled question.
export async function activeEntries(userId) {
  const [defs, questions] = await Promise.all([listTagDefinitions(userId), loadQuestions(userId)]);
  return defs
    .filter((d) => d.enabled && questions[d.key] && questions[d.key].enabled !== false)
    .map((d) => ({ key: d.key, name: d.name, question: questions[d.key] }));
}
