import '@testing-library/jest-dom'

// Node 22+ ships an experimental `localStorage` global that shadows jsdom's
// `window.localStorage` and throws "is not a function" when its backing file
// path is missing. Install a plain in-memory polyfill so tests that hit the
// Storage API (e.g. auth token flows) work regardless of Node version.
function installLocalStoragePolyfill() {
  const store = new Map<string, string>()
  const polyfill = {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => { store.clear() },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size },
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: polyfill,
    configurable: true,
    writable: true,
  })
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', {
      value: polyfill,
      configurable: true,
      writable: true,
    })
  }
}

installLocalStoragePolyfill()
