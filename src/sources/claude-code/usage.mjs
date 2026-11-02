import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

const RESCAN_MS = 5000
const SAVE_EVERY = 100
const VERSION = 1
const tick = () => new Promise((r) => setImmediate(r))
const key = (f) => `${f.file}|${f.st.size}|${f.st.mtimeMs}`

/**
 * Incremental per-file usage scan. `files()` lists { session, main, file, st } (main = the session's own
 * transcript, else a subagent one); `parse(text)` is parseTranscript. Each file reduces to day/model token
 * sums, cached under path|size|mtime in memory and (when `cachePath` is set) in a JSON file, so a changed
 * file is the only thing ever re-parsed. A scan yields between files; rows() answers at any time from what
 * is known so far (first scan: partial; later scans keep serving the previous result until they finish).
 */
export function createUsageScanner({ files, parse, costOf, cachePath = null, now = () => Date.now() }) {
  const cache = new Map() // key -> entry
  if (cachePath) {
    try {
      const j = JSON.parse(readFileSync(cachePath, "utf8"))
      if (j?.v === VERSION && j.files && typeof j.files === "object") for (const [k, e] of Object.entries(j.files)) cache.set(k, e)
    } catch { /* no cache yet, or unreadable: start empty */ }
  }
  let live = new Map() // key -> entry for the current file set
  let scanning = null
  let completedOnce = false
  let doneAt = 0
  let progress = { scanned: 0, total: 0 }

  function save(keep) {
    if (!cachePath) return
    try {
      const out = {}
      for (const k of keep) if (cache.has(k)) out[k] = cache.get(k)
      mkdirSync(dirname(cachePath), { recursive: true })
      const tmp = `${cachePath}.${process.pid}.tmp`
      writeFileSync(tmp, JSON.stringify({ v: VERSION, files: out }))
      renameSync(tmp, cachePath)
    } catch { /* the cache is an optimisation; a read-only home must not break the scan */ }
  }

  async function run() {
    const list = files()
    const target = completedOnce ? new Map() : live
    const todo = []
    const keep = new Set()
    for (const f of list) {
      const k = key(f)
      keep.add(k)
      const hit = cache.get(k)
      if (hit) target.set(k, { ...hit, session: f.session, main: f.main })
      else todo.push({ f, k })
    }
    progress = { scanned: list.length - todo.length, total: list.length }
    let sinceSave = 0
    for (const { f, k } of todo) {
      await tick()
      try {
        const p = parse(readFileSync(f.file, "utf8"))
        const days = new Map()
        for (const m of p.messages) {
          const day = (m.ts ?? p.firstTs ?? p.lastTs ?? new Date(f.st.mtimeMs).toISOString()).slice(0, 10)
          const model = m.model ?? "unknown"
          const d = days.get(`${day}|${model}`) ?? { day, model, in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }
          days.set(`${day}|${model}`, d)
          d.in += m.tokens.in; d.out += m.tokens.out; d.cacheRead += m.tokens.cacheRead; d.cacheWrite += m.tokens.cacheWrite
        }
        const entry = { cwd: p.meta.cwd, branch: p.meta.branch, days: [...days.values()] }
        cache.set(k, entry)
        target.set(k, { ...entry, session: f.session, main: f.main })
        if (++sinceSave >= SAVE_EVERY) { sinceSave = 0; save(keep) }
      } catch { /* unreadable or vanished: skipped this pass, retried on the next */ }
      progress.scanned++
    }
    live = target
    completedOnce = true
    doneAt = now()
    for (const k of [...cache.keys()]) if (!keep.has(k)) cache.delete(k)
    save(keep)
  }

  return {
    /** Start a scan unless one is running or the last finished less than a few seconds ago. */
    kick() {
      if (scanning || (completedOnce && now() - doneAt < RESCAN_MS)) return
      scanning = run().catch(() => {}).finally(() => { scanning = null })
    },
    /** Resolves when no scan is running. */
    idle: () => scanning ?? Promise.resolve(),
    status: () => ({ complete: completedOnce, ...progress }),
    /** UsageRow[] for days in [from, to] (YYYY-MM-DD, inclusive, both optional). */
    rows({ from, to } = {}) {
      const meta = new Map() // session -> main entry, so subagent files inherit its cwd and branch
      for (const e of live.values()) if (e.main) meta.set(e.session, e)
      const merged = new Map() // day|session|model: a session's subagent files fold into its row
      for (const e of live.values()) {
        const m = meta.get(e.session) ?? e
        const cwd = m.cwd ?? e.cwd ?? ""
        for (const d of e.days) {
          if ((from && d.day < from) || (to && d.day > to)) continue
          const k = `${d.day}|${e.session}|${d.model}`
          const r = merged.get(k) ?? {
            day: d.day, source: "claude-code", harness: "claude-code", project: cwd, worktree: cwd, branch: m.branch ?? e.branch ?? "",
            model: d.model, in: 0, out: 0, cacheRead: 0, cacheWrite: 0, cost: 0, sessions: 1, session: e.session,
          }
          merged.set(k, r)
          r.in += d.in; r.out += d.out; r.cacheRead += d.cacheRead; r.cacheWrite += d.cacheWrite
          r.cost += costOf(d.model, d)
        }
      }
      return [...merged.values()]
    },
  }
}
