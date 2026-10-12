// The tag the message list is filtered by (a tag key, or null). A plain module so the API layer can
// read it without importing the store; `subscribe` lets the filter bar re-render on change.
let active = null;
const listeners = new Set();

export const getTagFilter = () => active;

export function setTagFilterValue(key) {
  if (key === active) return;
  active = key;
  listeners.forEach((l) => l());
}

export function subscribeTagFilter(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
