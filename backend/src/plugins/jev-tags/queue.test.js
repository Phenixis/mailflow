import { describe, it, expect, vi } from 'vitest';
vi.mock('../api.js', () => ({ logger: { warn: vi.fn() } }));
import { createQueue } from './queue.js';

describe('tag queue', () => {
  it('runs each message once, drops duplicates while queued, and respects concurrency', async () => {
    let running = 0; let peak = 0;
    const run = vi.fn(async () => { running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 5)); running--; });
    const q = createQueue({ run, concurrency: 2 });
    expect(q.enqueue('u1', ['a', 'b', 'c', 'a'])).toBe(3);
    expect(q.enqueue('u1', ['b'])).toBe(0);
    await q.idle();
    expect(run).toHaveBeenCalledTimes(3);
    expect(peak).toBe(2);
    expect(q.enqueue('u1', ['a'])).toBe(1); // finished ids can be queued again (reclassify)
    await q.idle();
  });

  it('survives a failing job and keeps draining', async () => {
    const run = vi.fn(async (_u, id) => { if (id === 'bad') throw new Error('boom'); });
    const q = createQueue({ run, concurrency: 1 });
    q.enqueue('u1', ['bad', 'good']);
    await q.idle();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('caps the backlog', () => {
    const q = createQueue({ run: () => new Promise(() => {}), concurrency: 1, maxQueue: 2 });
    expect(q.enqueue('u1', ['a', 'b', 'c', 'd', 'e'])).toBe(2); // the cap applies to the waiting backlog
  });
});
