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
    size: () => pending.length + active,
    idle: () => (active || pending.length ? new Promise((r) => idleWaiters.push(r)) : Promise.resolve()),
  };
}

export const jevQueue = createQueue();
