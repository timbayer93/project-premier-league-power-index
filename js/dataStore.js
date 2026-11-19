/*
  dataStore.js
  Tiny fetch wrapper with caching. Several modules can each call
  loadJSON() for the same file — only the first call actually hits the
  network, everyone else gets the same cached promise.
*/

const cache = new Map();

export function loadJSON(path) {
  if (!cache.has(path)) {
    cache.set(
      path,
      fetch(path).then((r) => {
        if (!r.ok) throw new Error(`Failed to load ${path}: ${r.status}`);
        return r.json();
      })
    );
  }
  return cache.get(path);
}
