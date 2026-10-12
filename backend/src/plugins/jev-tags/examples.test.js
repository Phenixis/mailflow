import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api.js', () => ({ listTagExamples: vi.fn() }));
import { formatExample, mergeExamples, learnedExamples, withLearnedExamples, clearExamplesCache } from './examples.js';

const list = vi.fn();
beforeEach(() => { vi.clearAllMocks(); clearExamplesCache(); });

describe('mergeExamples', () => {
  it('keeps hand-written examples first, drops duplicates and caps the list', () => {
    expect(mergeExamples(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(mergeExamples(undefined, ['x'])).toEqual(['x']);
    expect(mergeExamples(Array.from({ length: 15 }, (_, i) => `h${i}`), Array.from({ length: 15 }, (_, i) => `l${i}`))).toHaveLength(20);
  });
});

describe('formatExample', () => {
  it('joins subject and sender, collapses whitespace and clips long text', () => {
    expect(formatExample({ subject: 'Flight\n to Rome', sender: 'Airline' })).toBe('Flight to Rome — Airline');
    expect(formatExample({ subject: 'Hello', sender: '' })).toBe('Hello');
    expect(formatExample({ subject: 'x'.repeat(300), sender: '' })).toHaveLength(160);
  });
});

describe('learnedExamples', () => {
  it('asks core for the user\'s own tagging, never including messages carrying the privacy tag, and caches briefly', async () => {
    list.mockResolvedValue({ positives: [{ subject: 'Flight', sender: 'Airline' }], negatives: [{ subject: 'Newsletter', sender: '' }] });
    const first = await learnedExamples('u1', 'travel', 'private', { now: 1000, list });
    expect(first).toEqual({ positives: ['Flight — Airline'], negatives: ['Newsletter'] });
    expect(list).toHaveBeenCalledWith('u1', 'travel', { excludeIfTagged: ['private'], limit: 8 });
    await learnedExamples('u1', 'travel', 'private', { now: 30_000, list });
    expect(list).toHaveBeenCalledTimes(1);
    await learnedExamples('u1', 'travel', 'private', { now: 70_000, list }); // expired: new tags are picked up
    expect(list).toHaveBeenCalledTimes(2);
  });
});

describe('withLearnedExamples', () => {
  const entries = [
    { key: 'private', question: { instructions: 'p', true_examples: ['own'] } },
    { key: 'travel', question: { instructions: 't', true_examples: ['hand'], false_examples: [] } },
    { key: 'quiet', question: { instructions: 'q', learn: false } },
  ];

  it('folds learned examples into learning tags only: not the privacy tag, not a tag that opted out', async () => {
    list.mockResolvedValue({ positives: [{ subject: 'Flight', sender: 'Airline' }], negatives: [{ subject: 'Newsletter', sender: 'News' }] });
    const out = await withLearnedExamples('u1', entries, 'private', { list });
    expect(out[0]).toBe(entries[0]);
    expect(out[2]).toBe(entries[2]);
    expect(out[1].question.true_examples).toEqual(['hand', 'Flight — Airline']);
    expect(out[1].question.false_examples).toEqual(['Newsletter — News']);
    expect(list).toHaveBeenCalledTimes(1);
    expect(entries[1].question.true_examples).toEqual(['hand']); // the stored question is not mutated
  });

  it('leaves a tag untouched when the user has not tagged anything yet', async () => {
    list.mockResolvedValue({ positives: [], negatives: [] });
    const out = await withLearnedExamples('u1', entries, 'private', { list });
    expect(out[1]).toBe(entries[1]);
  });
});
