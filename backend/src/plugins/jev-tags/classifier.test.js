import { describe, it, expect, vi } from 'vitest';
import { classify, buildQuestion, bodyExcerpt, verdict } from './classifier.js';
import { DEFAULT_TAGS, DEFAULT_SETTINGS } from './defaults.js';

const entries = DEFAULT_TAGS.map((t) => ({ key: t.key, question: t.question }));
const settings = { ...DEFAULT_SETTINGS };
const message = { from_name: 'Alex', from_email: 'alex@x.example', subject: 'Re: Thursday?', body_text: 'Yes, but tell me tonight.', snippet: 'Yes' };
const base = { entries, privacyKey: 'private', settings, today: '2026-10-12' };

// Fake Jev: scripted scores per pass.
function fakeAsk(...passes) {
  const queue = [...passes];
  return vi.fn(async (state, questions) => {
    const scores = queue.shift() ?? {};
    return {
      scores: Object.fromEntries(Object.keys(questions).map((key) => [key, scores[key]])),
      usage: { input: 100, output: 10 },
      model: 'jev-test',
    };
  });
}
const byKey = (out) => Object.fromEntries(out.results.map((r) => [r.tag.key, r]));

describe('verdict', () => {
  it('uses the band edges inclusively and treats a missing score as unsure', () => {
    expect(verdict(0.65, 0.35, 0.65)).toBe('yes');
    expect(verdict(0.35, 0.35, 0.65)).toBe('no');
    expect(verdict(0.5, 0.35, 0.65)).toBe('unsure');
    expect(verdict(undefined, 0.35, 0.65)).toBe('unsure');
  });
});

describe('classify', () => {
  it('asks every tag in one request with the date, sender and subject only', async () => {
    const ask = fakeAsk({ private: 0.1, important: 0.9, urgent: 0.1 });
    const out = await classify({ ...base, message, ask });
    expect(ask).toHaveBeenCalledTimes(1);
    const [state, questions] = ask.mock.calls[0];
    expect(state).toEqual({ current_date: '2026-10-12', sender_name: 'Alex', sender_address: 'alex@x.example', subject: 'Re: Thursday?' });
    expect(Object.keys(questions).sort()).toEqual(['important', 'private', 'urgent']);
    expect(byKey(out).important.applied).toBe(true);
    expect(byKey(out).urgent.applied).toBe(false);
    expect(out.bodySent).toBe(false);
  });

  it('tags private above 0.4 and never sends the body, even when other tags are unsure', async () => {
    const ask = fakeAsk({ private: 0.41, important: 0.5, urgent: 0.5 });
    const out = await classify({ ...base, message, ask });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(out.isPrivate).toBe(true);
    expect(byKey(out).private.applied).toBe(true);
    expect(byKey(out).important.applied).toBe(false);
    expect(out.bodySent).toBe(false);
  });

  it('keeps the important/urgent tags that pass 1 settled on a private message', async () => {
    const ask = fakeAsk({ private: 0.9, important: 0.84, urgent: 0.1 });
    const out = await classify({ ...base, message, ask });
    expect(byKey(out).private.applied).toBe(true);
    expect(byKey(out).important.applied).toBe(true);
  });

  it('treats a missing privacy score as private (zero trust)', async () => {
    const ask = fakeAsk({ important: 0.5 });
    const out = await classify({ ...base, message, ask });
    expect(out.isPrivate).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('runs pass 2 with the body for unsure tags only when the message is not private', async () => {
    const ask = fakeAsk({ private: 0.17, important: 0.42, urgent: 0.28 }, { important: 0.72 });
    const out = await classify({ ...base, message, ask });
    expect(ask).toHaveBeenCalledTimes(2);
    const [state2, questions2] = ask.mock.calls[1];
    expect(Object.keys(questions2)).toEqual(['important']);
    expect(state2.body_excerpt).toBe('Yes, but tell me tonight.');
    expect(byKey(out).important).toMatchObject({ applied: true, pass: 2, bodySent: true, score: 0.72 });
    expect(byKey(out).urgent).toMatchObject({ applied: false, pass: 1, bodySent: false });
    expect(out.pass).toBe(2);
    expect(out.usage).toEqual({ input: 200, output: 20 });
  });

  it('leaves a tag unapplied when it is still unsure and there is no body to send', async () => {
    const ask = fakeAsk({ private: 0.1, important: 0.5, urgent: 0.1 });
    const out = await classify({ ...base, message: { ...message, body_text: null, snippet: '' }, ask });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(byKey(out).important.applied).toBe(false);
  });

  it('never sends a body when there is no privacy gate among the tags', async () => {
    const ask = fakeAsk({ important: 0.5, urgent: 0.1 });
    const out = await classify({ ...base, entries: entries.filter((e) => e.key !== 'private'), message, ask });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(out.bodySent).toBe(false);
  });

  it('honours a per-tag threshold override', async () => {
    const custom = entries.map((e) => (e.key === 'urgent' ? { ...e, question: { ...e.question, threshold_high: '0.9' } } : e));
    const ask = fakeAsk({ private: 0.1, important: 0.1, urgent: 0.8 });
    const out = await classify({ ...base, entries: custom, message: { ...message, body_text: '', snippet: '' }, ask });
    expect(byKey(out).urgent.applied).toBe(false); // 0.8 < 0.9
  });

  it('works for a tag the user invented', async () => {
    const travel = { key: 'travel', question: { instructions: 'About a trip?', true_examples: ['Your flight'], false_examples: [] } };
    const ask = fakeAsk({ private: 0.1, important: 0.1, urgent: 0.1, travel: 0.95 });
    const out = await classify({ ...base, entries: [...entries, travel], message, ask });
    expect(byKey(out).travel.applied).toBe(true);
    expect(ask.mock.calls[0][1].travel).toEqual({ type: 'noul', instructions: 'About a trip?', criteria: { true: { examples: ['Your flight'] } } });
  });
});

describe('buildQuestion', () => {
  it('omits empty criteria sides', () => {
    expect(buildQuestion({ instructions: 'Q?', true_what: 'yes', true_examples: [], false_what: null, false_examples: [] }))
      .toEqual({ type: 'noul', instructions: 'Q?', criteria: { true: { what: 'yes' } } });
    expect(buildQuestion({ instructions: 'Q?', true_examples: [], false_examples: [] })).toEqual({ type: 'noul', instructions: 'Q?' });
  });
});

describe('bodyExcerpt', () => {
  it('drops quoted lines, collapses whitespace, truncates, and falls back to the snippet', () => {
    expect(bodyExcerpt({ body_text: 'Hello\n> quoted\n\n  world ' }, 500)).toBe('Hello world');
    expect(bodyExcerpt({ body_text: 'abcdefghij' }, 4)).toBe('abcd');
    expect(bodyExcerpt({ body_text: null, snippet: 'preview' }, 500)).toBe('preview');
    expect(bodyExcerpt({}, 500)).toBe('');
  });
});
