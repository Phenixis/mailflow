// In-process work queue so mail sync never waits on Jev: ingest enqueues and returns at once.
// Small fixed concurrency keeps us well under the API's rate limits; duplicates are dropped.
import { logger } from '../api.js';
import { classifyMessage } from './service.js';

const CONCURRENCY = 2;
const MAX_QUEUE = 5000;

export function createQueue({ run = classifyMessage, concurrency = CONCURRENCY, maxQueue = MAX_QUEUE } = {}) {
  const pending = [];
  const known = new Set(); // message ids queued or running
  let active = 0;
  let idleWaiters = [];
  const settleWaiters = new Set(); // { left: Set of message ids, resolve }

  function pump() {
    while (active < concurrency && pending.length) {
      const job = pending.shift();
      active++;
      Promise.resolve()
        .then(() => run(job.userId, job.messageId))
        .catch((err) => logger.warn(`Jev queue job failed: ${err.name}`))
        .finally(() => {
          active--;
          known.delete(job.messageId);
          for (const w of settleWaiters) {
            w.left.delete(job.messageId);
            if (!w.left.size) { settleWaiters.delete(w); w.resolve(); }
          }
          pump();
          if (!active && !pending.length) { idleWaiters.forEach((r) => r()); idleWaiters = []; }
        });
    }
  }

  return {
    enqueue(userId, messageIds) {
      let added = 0;
      for (const messageId of messageIds) {
        if (known.has(messageId) || pending.length >= maxQueue) continue;
        known.add(messageId);
        pending.push({ userId, messageId });
        added++;
      }
      pump();
      return added;
    },
    // Resolves once none of these messages is queued or running any more (finished, failed or never queued).
    settled(messageIds) {
      const left = new Set(messageIds.filter((id) => known.has(id)));
      if (!left.size) return Promise.resolve();
      return new Promise((resolve) => settleWaiters.add({ left, resolve }));
    },
    size: () => pending.length + active,
    idle: () => (active || pending.length ? new Promise((r) => idleWaiters.push(r)) : Promise.resolve()),
  };
}

export const jevQueue = createQueue();
