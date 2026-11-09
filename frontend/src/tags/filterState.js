// The tags the message list is filtered by: a list of tag keys and how to combine them ('any' = at
// least one, 'all' = every one). A plain module so the API layer can read it without importing the
// store; `subscribe` lets the filter bar re-render on change. The snapshot is replaced (never
// mutated) on every change, so it is safe to use with useSyncExternalStore.
let state = { keys: [], mode: 'any' };
const listeners = new Set();

export const getTagFilter = () => state;

export function setTagFilterState(next) {
  const keys = [...new Set(next.keys ?? state.keys)];
  const mode = next.mode ?? state.mode;
  if (mode === state.mode && keys.length === state.keys.length && keys.every((k, i) => k === state.keys[i])) return;
  state = { keys, mode };
  listeners.forEach((l) => l());
}

export function subscribeTagFilter(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
