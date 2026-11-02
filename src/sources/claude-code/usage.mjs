import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { bucketOf, defaultTz, localDay, shiftDay } from "../../usage.mjs"

const RESCAN_MS = 5000
const SAVE_EVERY = 100
const VERSION = 2
const tick = () => new Promise((r) => setImmediate(r))
const key = (f) => `${f.file}|${f.st.size}|${f.st.mtimeMs}`

/**
 * Incremental per-file usage scan. `files()` lists { session, main, file, st } (main = the session's own
 * transcript, else a subagent one); `parseFile(path, st)` (or `parse(text)`) is parseTranscript. Each file reduces to day/model token
 * sums per 15-minute UTC bucket (so any time zone can be applied later), cached under path|size|mtime in memory and (when `cachePath` is set) in a JSON file, so a changed
 * file is the only thing ever re-parsed. A scan yields between files; rows() answers at any time from what
 * is known so far (first scan: partial; later scans keep serving the previous result until they finish).
 */
const nonNeg = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0
const wellFormed = (e) =>
  !!e && typeof e === "object" && Array.isArray(e.days) &&
  e.days.every((d) => d && typeof d.b === "string" && typeof d.model === "string" && ["in", "out", "cacheRead", "cacheWrite"].every((k) => nonNeg(d[k])))

export function createUsageScanner({ files, parse, parseFile = (file) => parse(readFileSync(file, "utf8")), costOf, cachePath = null, now = () => Date.now() }) {
  const cache = new Map() // key -> entry
  if (cachePath) {
    try {
      const j = JSON.parse(readFileSync(cachePath, "utf8"))
      if (j?.v === VERSION && j.files && typeof j.files === "object") for (const [k, e] of Object.entries(j.files)) if (wellFormed(e)) cache.set(k, e)
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
      // Private: the cache names every project path and session id. Dir 0700, file 0600.
      mkdirSync(dirname(cachePath), { recursive: true, mode: 0o700 })
      try { chmodSync(dirname(cachePath), 0o700) } catch { /* not ours to change */ }
      const tmp = `${cachePath}.${process.pid}.tmp`
      writeFileSync(tmp, JSON.stringify({ v: VERSION, files: out }), { mode: 0o600 })
      renameSync(tmp, cachePath)
    } catch { /* the cache is an optimisation; a read-only home must not break the scan */ }
  }

  async function run() {
    const list = files()
    const target = completedOnce ? new Map() : live
    const before = new Map([...live.values()].map((e) => [e.file, e])) // last good result per path, for a failed re-read
    const todo = []
    const keep = new Set()
    for (const f of list) {
      const k = key(f)
      keep.add(k)
      const hit = cache.get(k)
      if (hit) target.set(k, { ...hit, session: f.session, main: f.main, file: f.file })
      else todo.push({ f, k })
    }
    progress = { scanned: list.length - todo.length, total: list.length }
    let sinceSave = 0
    for (const { f, k } of todo) {
      await tick()
      try {
        const p = parseFile(f.file, f.st)
        const days = new Map()
        for (const m of p.messages) {
          const b = bucketOf(m.ts) ?? bucketOf(p.firstTs) ?? bucketOf(p.lastTs) ?? bucketOf(new Date(f.st.mtimeMs).toISOString())
          const model = m.model ?? "unknown"
          const d = days.get(`${b}|${model}`) ?? { b, model, in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }
          days.set(`${b}|${model}`, d)
          d.in += m.tokens.in; d.out += m.tokens.out; d.cacheRead += m.tokens.cacheRead; d.cacheWrite += m.tokens.cacheWrite
        }
        const entry = { cwd: p.meta.cwd, branch: p.meta.branch, days: [...days.values()] }
        cache.set(k, entry)
        target.set(k, { ...entry, session: f.session, main: f.main, file: f.file })
        if (++sinceSave >= SAVE_EVERY) { sinceSave = 0; save(keep) }
      } catch {
        // Unreadable or vanished mid-scan: keep this file's previous result, retry on the next pass.
        const prev = before.get(f.file)
        if (prev) target.set(k, prev)
      }
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
    /** UsageRow[] for local days in [from, to] (YYYY-MM-DD, inclusive, both optional) in zone `tz`. */
    rows({ from, to, tz = defaultTz() } = {}) {
      const lo = from ? `${shiftDay(from, -1)}T` : null // raw UTC filter, a day wider each side
      const hi = to ? `${shiftDay(to, 1)}T99` : null
      const meta = new Map() // session -> main entry, so subagent files inherit its cwd and branch
      for (const e of live.values()) if (e.main) meta.set(e.session, e)
      const merged = new Map() // day|session|model: a session's subagent files fold into its row
      for (const e of live.values()) {
        const m = meta.get(e.session) ?? e
        const cwd = m.cwd ?? e.cwd ?? ""
        for (const d of e.days) {
          if ((lo && d.b < lo) || (hi && d.b > hi)) continue
          const day = localDay(d.b, tz)
          if ((from && day < from) || (to && day > to)) continue
          const k = `${day}|${e.session}|${d.model}`
          const r = merged.get(k) ?? {
            day, source: "claude-code", harness: "claude-code", project: cwd, worktree: cwd, branch: m.branch ?? e.branch ?? "",
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
