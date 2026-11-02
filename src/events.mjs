import { statSync, watch } from "node:fs"

/**
 * Change feed for /api/events: fs.watch on the hook log dirs (a hook line lands the moment Claude Code or
 * Codex asks) plus a polled stat of the live session files, debounced. `targets()` -> { dirs, files }
 * (re-read on every poll, so new live files and a hooks dir created later are picked up). `onChange` fires
 * at most once per `debounceMs`. Started only while someone listens; stop() releases everything.
 */
export function createChangeFeed({ targets, debounceMs = 250, pollMs = 1000, onChange }) {
  const watchers = new Map() // dir -> FSWatcher
  const stamps = new Map() // file -> "mtime|size"
  let timer = null, poller = null

  const fire = () => {
    if (timer) return
    timer = setTimeout(() => { timer = null; onChange() }, debounceMs)
    timer.unref?.()
  }
  const stampOf = (f) => { try { const st = statSync(f); return `${st.mtimeMs}|${st.size}` } catch { return "-" } }

  function sync() {
    let t
    try { t = targets() } catch { return }
    const dirs = new Set(t.dirs ?? [])
    for (const [d, w] of watchers) if (!dirs.has(d)) { w.close(); watchers.delete(d) }
    for (const d of dirs) {
      if (watchers.has(d)) continue
      try {
        const w = watch(d, { persistent: false }, fire)
        w.on("error", () => { w.close(); watchers.delete(d) }) // dir removed: try again next poll
        watchers.set(d, w)
      } catch { /* not there yet */ }
    }
    const files = new Set(t.files ?? [])
    for (const f of stamps.keys()) if (!files.has(f)) stamps.delete(f)
    let changed = false
    for (const f of files) {
      const s = stampOf(f)
      if (stamps.has(f) && stamps.get(f) !== s) changed = true
      stamps.set(f, s)
    }
    if (changed) fire()
  }

  return {
    start() {
      if (poller) return
      sync()
      poller = setInterval(sync, pollMs)
      poller.unref?.()
    },
    stop() {
      clearInterval(poller); poller = null
      clearTimeout(timer); timer = null
      for (const w of watchers.values()) w.close()
      watchers.clear(); stamps.clear()
    },
    running: () => poller !== null,
  }
}
