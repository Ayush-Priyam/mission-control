/** Tiny LRU for parsed sessions, keyed by file identity so a changed file is never served stale. */
export function createCache(max = 64) {
  const map = new Map()
  return {
    key: (path, st) => `${path}|${st.size}|${st.mtimeMs}`,
    get(key) {
      if (!map.has(key)) return undefined
      const v = map.get(key)
      map.delete(key)
      map.set(key, v)
      return v
    },
    set(key, value) {
      map.delete(key)
      map.set(key, value)
      while (map.size > max) map.delete(map.keys().next().value)
      return value
    },
    size: () => map.size,
  }
}
