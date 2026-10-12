// The classification workflow, kept free of I/O: the caller injects `ask` (a Jev request) so the
// decision logic can be tested without a network or a database.
//
// Pass 1 sends sender + subject + today's date with every enabled tag as one request.
//   - the privacy tag scoring above `private_above` (or missing) marks the message private, and
//     a private message's body is NEVER sent;
//   - other tags: score >= high applies the tag, score <= low rules it out, anything between
//     (or a missing score) is "unsure".
// Pass 2 runs only for unsure tags on a non-private message that has a body, re-asking just those
// tags with an excerpt of the body.

export function buildQuestion(def) {
  const question = { type: 'noul', instructions: def.instructions };
  const trueSide = sideCriteria(def.true_what, def.true_examples);
  const falseSide = sideCriteria(def.false_what, def.false_examples);
  if (trueSide || falseSide) {
    question.criteria = {};
    if (trueSide) question.criteria.true = trueSide;
    if (falseSide) question.criteria.false = falseSide;
  }
  return question;
}

function sideCriteria(what, examples) {
  const out = {};
  if (what) out.what = what;
  if (Array.isArray(examples) && examples.length) out.examples = examples;
  return Object.keys(out).length ? out : null;
}

const num = (value) => (value === null || value === undefined ? null : Number(value));

export function verdict(score, low, high) {
  if (typeof score !== 'number') return 'unsure';
  if (score >= high) return 'yes';
  if (score <= low) return 'no';
  return 'unsure';
}

// A short, quote-free excerpt of the body for pass 2. Falls back to the snippet when the body has
// not been fetched. Returns '' when there is nothing to send.
export function bodyExcerpt(message, maxChars) {
  const raw = message.body_text || message.snippet || '';
  const text = raw
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('>'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, Math.max(0, maxChars));
}

// `entries` are the tags to ask about: { key, question: {instructions, true_what, ..., threshold_low?,
// threshold_high?} }. The one whose key is `privacyKey` is the privacy gate.
export async function classify({ message, entries, privacyKey, settings, ask, today }) {
  const defs = entries.map((e) => ({ ...e.question, key: e.key }));
  const privacy = defs.find((d) => d.key === privacyKey) || null;
  const low = num(settings.threshold_low);
  const high = num(settings.threshold_high);
  const privateAbove = num(settings.private_above);
  const usage = { input: 0, output: 0 };
  const results = new Map(); // tag key -> { tag, score, applied, pass, bodySent }

  if (!defs.length) return { results: [], isPrivate: false, bodySent: false, pass: 1, usage, model: null };

  const state = {
    current_date: today,
    sender_name: message.from_name ?? '',
    sender_address: message.from_email ?? '',
    subject: message.subject ?? '',
  };
  const toQuestions = (list) => Object.fromEntries(list.map((d) => [d.key, buildQuestion(d)]));
  const track = (r) => { usage.input += r.usage.input; usage.output += r.usage.output; return r; };

  const first = track(await ask(state, toQuestions(defs)));
  let model = first.model;

  // Zero trust: a missing or doubtful privacy score counts as private.
  let isPrivate = false;
  if (privacy) {
    const score = first.scores[privacy.key];
    isPrivate = typeof score !== 'number' || score > privateAbove;
    results.set(privacy.key, { tag: privacy, score, applied: isPrivate, pass: 1, bodySent: false });
  }

  const unsure = [];
  for (const def of defs) {
    if (def === privacy) continue;
    const score = first.scores[def.key];
    const lo = num(def.threshold_low) ?? low;
    const hi = num(def.threshold_high) ?? high;
    const v = verdict(score, lo, hi);
    results.set(def.key, { tag: def, score, applied: v === 'yes', pass: 1, bodySent: false });
    if (v === 'unsure') unsure.push(def);
  }

  let pass = 1;
  let bodySent = false;
  const excerpt = bodyExcerpt(message, num(settings.max_body_chars) ?? 500);
  if (unsure.length && privacy && !isPrivate && excerpt) {
    const second = track(await ask({ ...state, body_excerpt: excerpt }, toQuestions(unsure)));
    model = second.model ?? model;
    pass = 2;
    bodySent = true;
    for (const def of unsure) {
      const score = second.scores[def.key];
      const hi = num(def.threshold_high) ?? high;
      const lo = num(def.threshold_low) ?? low;
      results.set(def.key, {
        tag: def, score, applied: verdict(score, lo, hi) === 'yes', pass: 2, bodySent: true,
      });
    }
  }

  return { results: [...results.values()], isPrivate, bodySent, pass, usage, model };
}
