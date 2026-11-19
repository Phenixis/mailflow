// The tags the message list is filtered by: a list of tag ids and how to combine them ('any' = at
// least one, 'all' = every one). A plain module so the API layer can read it without importing the
// store; `subscribe` lets the filter bar re-render on change. The snapshot is replaced (never
// mutated) on every change, so it is safe to use with useSyncExternalStore.
let state = { ids: [], mode: 'any' };
const listeners = new Set();

export const getTagFilter = () => state;

export function setTagFilterState(next) {
  const ids = [...new Set(next.ids ?? state.ids)];
  const mode = next.mode ?? state.mode;
  if (mode === state.mode && ids.length === state.ids.length && ids.every((k, i) => k === state.ids[i])) return;
  state = { ids, mode };
  listeners.forEach((l) => l());
}

export function subscribeTagFilter(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
