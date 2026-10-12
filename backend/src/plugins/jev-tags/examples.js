// Examples a tag's question learns from the user's own tagging: subjects (with the sender's name) of
// mail the user tagged by hand, and of mail where they removed the tag. The privacy tag never
// learns, and a message that carries it is never used as an example, so private subjects are not
// sent as examples for other tags.
import { listTagExamples } from '../api.js';

const MAX_EXAMPLES = 20; // per side, hand-written ones first
const MAX_LENGTH = 160;
const TTL_MS = 60_000;

const cache = new Map(); // `${userId}:${tagKey}:${privacyKey}` -> { at, value }

const clip = (text) => (text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH - 1)}…` : text);
export const formatExample = ({ subject, sender }) => clip(sender ? `${subject} — ${sender}` : subject).replace(/\s+/g, ' ').trim();

// Hand-written examples first, then the learned ones, without duplicates, up to the cap.
export function mergeExamples(handwritten = [], learned = []) {
  const out = [];
  for (const example of [...handwritten, ...learned]) {
    if (example && !out.includes(example)) out.push(example);
    if (out.length >= MAX_EXAMPLES) break;
  }
  return out;
}

export async function learnedExamples(userId, tagKey, privacyKey, { now = Date.now(), list = listTagExamples } = {}) {
  const key = `${userId}:${tagKey}:${privacyKey}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.value;
  const { positives, negatives } = await list(userId, tagKey, { excludeIfTagged: privacyKey ? [privacyKey] : [], limit: 8 });
  const value = { positives: positives.map(formatExample), negatives: negatives.map(formatExample) };
  cache.set(key, { at: now, value });
  return value;
}

export const clearExamplesCache = () => cache.clear();

// The entries with learned examples folded into their questions. The privacy tag and any tag whose
// question turned learning off are left as they are.
export async function withLearnedExamples(userId, entries, privacyKey, options) {
  return Promise.all(entries.map(async (entry) => {
    if (entry.key === privacyKey || entry.question.learn === false) return entry;
    const { positives, negatives } = await learnedExamples(userId, entry.key, privacyKey, options);
    if (!positives.length && !negatives.length) return entry;
    return {
      ...entry,
      question: {
        ...entry.question,
        true_examples: mergeExamples(entry.question.true_examples, positives),
        false_examples: mergeExamples(entry.question.false_examples, negatives),
      },
    };
  }));
}
