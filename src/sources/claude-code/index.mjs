import { closeSync, openSync, readSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs"
import { join, sep } from "node:path"
import { readWaiting } from "../../hooks.mjs"
import { capText, isSessionName } from "../../names.mjs"
import { createCache } from "./cache.mjs"
import { parseTranscript, peek } from "./parse.mjs"
import { costOf } from "./prices.mjs"
import { createUsageScanner } from "./usage.mjs"

const LIVE_MS = 2 * 60 * 1000
const TAIL_BYTES = 64 * 1024
const WAIT_EXPIRY_MS = 12 * 3600 * 1000
const CLEAR_GAP_MS = 2000
const HEAD_BYTES = 64 * 1024
const HEAD_MAX = 1024 * 1024 // read forward this far for the first line carrying a cwd
const SAFE = /^[\w-][\w.-]*$/ // one path segment: no separators, never starts with a dot
const zero = () => ({ in: 0, out: 0, cacheRead: 0, cacheWrite: 0 })
const add = (a, b) => { a.in += b.in; a.out += b.out; a.cacheRead += b.cacheRead; a.cacheWrite += b.cacheWrite }
const iso = (ms) => new Date(ms).toISOString()

/**
 * Claude Code sessions as a v2 source. `root` is the projects dir (default ~/.claude/projects),
 * `now` an injectable clock. `hooksDir` holds the level-1 hook logs: a session whose last Notification is
 * unanswered is "waiting" (an idle reminder is "ready", i.e. idle). Read-only; every file read is confined to the real path of `root`. `cachePath` is where the
 * usage scan persists its per-file results (omitted: memory only); `parse` is injectable for tests.
 */
export function create({ root, now = () => Date.now(), hooksDir, cachePath, parse = parseTranscript } = {}) {
  const cache = createCache()
  const peeked = createCache(8192) // path|size|mtime -> peek of the head, so warm lists skip file reads
  const opened = new Map() // id -> { lastMs, summary } of sessions already fully parsed, for list totals
  let realRoot = null
  const rootReal = () => (realRoot ??= realpathSync(root))

  /** stat + confinement: the file's real path must sit inside the root, else null. */
  function confined(file) {
    try {
      const real = realpathSync(file)
      if (!real.startsWith(rootReal() + sep)) return null
      const st = statSync(real)
      return st.isFile() ? { real, st } : null
    } catch { return null }
  }

  function head(file, bytes) {
    let fd
    try {
      fd = openSync(file, "r")
      const buf = Buffer.alloc(bytes)
      return buf.toString("utf8", 0, readSync(fd, buf, 0, bytes, 0))
    } finally { if (fd !== undefined) closeSync(fd) }
  }

  /**
   * Claude Code slugs replace "/" with "-", so a decoded path is only a hint (real dashes are lost):
   * walk the slug segment by segment, joining with "-" where the plain split names no directory.
   * Returns a real directory or null.
   */
  function slugCwd(slug) {
    const parts = slug.split("-").slice(1)
    const walk = (base, i) => {
      if (i === parts.length) return base
      for (let j = parts.length; j > i; j--) {
        const next = join(base, parts.slice(i, j).join("-"))
        let ok = false
        try { ok = statSync(next).isDirectory() } catch { /* not there */ }
        if (ok) { const r = walk(next, j); if (r) return r }
      }
      return null
    }
    return slug.startsWith("-") && parts.length ? walk(sep, 0) : null
  }

  /** peek of the file head: 64 KB first, then up to 1 MB when no line with a cwd was seen, then the slug. */
  function peekFile(c, slug) {
    let h = peek(head(c.real, HEAD_BYTES))
    if (!h.cwd && c.st.size > HEAD_BYTES) h = peek(head(c.real, Math.min(c.st.size, HEAD_MAX)))
    if (!h.cwd) h.cwd = slugCwd(slug)
    return h
  }

  const dirs = (p) => { try { return readdirSync(p, { withFileTypes: true }) } catch { return [] } }

  /** Session files on disk: { id, file, slug } for every <root>/<slug>/<id>.jsonl. */
  function sessionFiles() {
    const out = []
    for (const d of dirs(root)) {
      if (!d.isDirectory() || !SAFE.test(d.name)) continue
      for (const f of dirs(join(root, d.name))) {
        if (f.isFile() && f.name.endsWith(".jsonl") && SAFE.test(f.name)) out.push({ id: f.name.slice(0, -6), slug: d.name, file: join(root, d.name, f.name) })
      }
    }
    return out
  }

  function locate(id) {
    if (typeof id !== "string" || !SAFE.test(id)) return null
    for (const d of dirs(root)) {
      if (!d.isDirectory() || !SAFE.test(d.name)) continue
      const file = join(root, d.name, `${id}.jsonl`)
      if (confined(file)) return { id, slug: d.name, file }
    }
    return null
  }

  /** Subagent transcripts of a session with their meta: [{ aid, file, meta }]. */
  function subagents(s) {
    const dir = join(root, s.slug, s.id, "subagents")
    const out = []
    for (const f of dirs(dir)) {
      const m = /^agent-([\w-]+)\.jsonl$/.exec(f.name)
      if (!m || !f.isFile()) continue
      let meta = {}
      try {
        const mp = confined(join(dir, `agent-${m[1]}.meta.json`))
        const j = mp && JSON.parse(readFileSync(mp.real, "utf8"))
        if (j && typeof j === "object") meta = j
      } catch { /* missing or broken meta: lane keeps its id as label */ }
      out.push({ aid: m[1], file: join(dir, f.name), meta })
    }
    return out.sort((a, b) => a.aid.localeCompare(b.aid))
  }

  function parseFile(file) {
    const c = confined(file)
    if (!c) return null
    const key = cache.key(c.real, c.st)
    return cache.get(key) ?? cache.set(key, { ...parseTranscript(readFileSync(c.real, "utf8")), mtimeMs: c.st.mtimeMs })
  }

  /** Every transcript that counts toward usage: sessions and their subagents, with stat. */
  function usageFiles() {
    const out = []
    for (const s of sessionFiles()) {
      const c = confined(s.file)
      if (!c) continue
      out.push({ session: s.id, main: true, file: c.real, st: c.st })
      for (const a of subagents(s)) {
        const ac = confined(a.file)
        if (ac) out.push({ session: s.id, main: false, file: ac.real, st: ac.st })
      }
    }
    return out
  }
  const scanner = createUsageScanner({ files: usageFiles, parse, costOf, cachePath, now })

  /** Newest user/assistant record timestamp (ms) in the tail of a main log; summary/system lines are ignored. */
  function lastTurnMs(file, size) {
    let fd
    try {
      fd = openSync(file, "r")
      const n = Math.min(size, TAIL_BYTES)
      const buf = Buffer.alloc(n)
      readSync(fd, buf, 0, n, size - n)
      let best = 0
      for (const line of buf.toString("utf8").split("\n")) {
        if (!line.includes('"timestamp"')) continue
        try {
          const j = JSON.parse(line)
          if (j && (j.type === "user" || j.type === "assistant")) best = Math.max(best, Date.parse(j.timestamp) || 0)
        } catch { /* half-written or cut first line */ }
      }
      return best
    } catch { return 0 } finally { if (fd !== undefined) closeSync(fd) }
  }

  /**
   * Hook-derived state: { waiting, message } or { ready } or null. A Notification stays open until a clearing
   * hook arrives or the MAIN log gains a user/assistant record more than 2 s after it; it expires after 12 h.
   */
  function waitingOf(id, main, logged) {
    if (!hooksDir || (logged && !logged.has(`${id}.jsonl`))) return null
    const w = readWaiting(hooksDir, id)
    if (!w.waiting && !w.ready) return null
    const since = Date.parse(w.since)
    if (Number.isFinite(since)) {
      if (now() - since > WAIT_EXPIRY_MS) return null
      if (lastTurnMs(main.real, main.st.size) > since + CLEAR_GAP_MS) return null
    }
    return w
  }

  const liveAt = (ms) => now() - ms <= LIVE_MS

  function laneOf(p, { id, label, kind, parent, model, live, finished }) {
    const lane = {
      id, label, kind,
      status: finished ? "done" : live ? "working" : "idle",
      calls: p.calls.length, errors: p.errors, tokens: p.tokens, cost: p.cost,
    }
    const m = model ?? p.firstModel
    if (m) lane.model = m
    if (parent) lane.parent = parent
    if (p.nowDoing && !finished) lane.nowDoing = p.nowDoing
    if (p.firstTs) lane.startedAt = p.firstTs
    if (p.lastTs && (finished || !live)) lane.endedAt = p.lastTs
    return lane
  }

  /** Full parse of one session: summary, lanes, and calls per lane (subagent calls linked to Agent calls). */
  function load(s) {
    const main = confined(s.file)
    const mp = main && parseFile(s.file)
    if (!mp) return null
    const subs = subagents(s).map((a) => ({ ...a, p: parseFile(a.file), mt: confined(a.file)?.st.mtimeMs ?? 0 })).filter((a) => a.p)
    const lastMs = Math.max(main.st.mtimeMs, ...subs.map((a) => a.mt))
    const live = liveAt(lastMs)
    const lanes = [laneOf(mp, { id: "main", label: "main", kind: "main", live })]
    const calls = mp.calls.map((c) => ({ ...c }))
    const byUse = new Map(calls.map((c) => [c.id, c]))
    for (const a of subs) {
      const id = `agent-${a.aid}`
      const label = typeof a.meta.description === "string" && a.meta.description ? a.meta.description : a.aid
      lanes.push({
        ...laneOf(a.p, { id, label, kind: "subagent", parent: "main", model: typeof a.meta.model === "string" ? a.meta.model : undefined, live: liveAt(a.mt), finished: a.meta.finished === true }),
        ...(typeof a.meta.agentType === "string" ? { agentType: a.meta.agentType } : {}),
      })
      for (const c of a.p.calls) calls.push({ ...c, lane: id })
      const link = typeof a.meta.toolUseId === "string" ? byUse.get(a.meta.toolUseId) : null
      if (link && link.kind === "agent") link.subLane = id
    }
    calls.sort((x, y) => x.ts.localeCompare(y.ts))
    const tokens = zero()
    let cost = 0, errors = 0
    for (const l of lanes) { add(tokens, l.tokens); cost += l.cost; errors += l.errors }
    const running = lanes.some((l) => l.status === "working")
    const w = waitingOf(s.id, main)
    if (w?.waiting) {
      lanes[0].status = "waiting"
      lanes[0].reason = w.message ?? "Waiting for you"
    } else if (w?.ready) {
      lanes[0].status = "idle"
      lanes[0].reason = "ready for input"
    }
    const summary = {
      source: "claude-code", id: s.id, kind: "session",
      title: mp.meta.title ?? s.id, harness: "claude-code",
      cwd: mp.meta.cwd, branch: mp.meta.branch,
      live: running, status: w?.waiting ? "waiting" : w?.ready ? "idle" : running ? "working" : "idle", waiting: !!w?.waiting,
      startedAt: mp.firstTs, updatedAt: iso(lastMs),
      counts: { lanes: lanes.length, calls: calls.length, errors },
      tokens, cost,
    }
    if (mp.meta.version) summary.version = mp.meta.version
    opened.set(s.id, { lastMs, summary })
    return { summary, lanes, calls, events: [] }
  }

  return {
    name: "claude-code",
    harness: "claude-code",

    /** stat + the first 64 KB of each file only; totals appear once a session has been opened. */
    async listItems() {
      const items = []
      const logged = new Set(hooksDir ? dirs(hooksDir).map((d) => d.name) : []) // one readdir instead of a miss per session
      for (const s of sessionFiles()) {
        try {
          const c = confined(s.file)
          if (!c) continue
          const subs = dirs(join(root, s.slug, s.id, "subagents")).filter((f) => f.isFile() && /^agent-[\w-]+\.jsonl$/.test(f.name))
          let lastMs = c.st.mtimeMs
          for (const f of subs) lastMs = Math.max(lastMs, confined(join(root, s.slug, s.id, "subagents", f.name))?.st.mtimeMs ?? 0)
          const pk = cache.key(c.real, c.st)
          const h = peeked.get(pk) ?? peeked.set(pk, peekFile(c, s.slug))
          const o = opened.get(s.id)
          const done = o && o.lastMs === lastMs ? o.summary : null
          const live = liveAt(lastMs)
          const w = waitingOf(s.id, c, logged)
          items.push({
            source: "claude-code", id: s.id, kind: "session",
            title: h.title ?? s.id, harness: "claude-code",
            cwd: h.cwd, branch: h.branch,
            live, status: w?.waiting ? "waiting" : w?.ready ? "idle" : live ? "working" : "idle", waiting: !!w?.waiting,
            startedAt: h.startedAt, updatedAt: iso(lastMs),
            counts: { lanes: 1 + subs.length, calls: done?.counts.calls ?? 0, errors: done?.counts.errors ?? 0 },
            tokens: done?.tokens ?? zero(), cost: done?.cost ?? 0,
          })
        } catch { /* one unreadable file must not hide the rest */ }
      }
      return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    },

    async getItem(id) {
      const s = locate(id)
      const r = s && load(s)
      return r && { summary: r.summary, lanes: r.lanes, events: r.events }
    },

    async getCalls(id, { lane, kind, q } = {}) {
      const s = locate(id)
      const r = s && load(s)
      if (!r) return []
      const needle = q ? String(q).toLowerCase() : null
      return r.calls.filter((c) =>
        (!lane || c.lane === lane) && (!kind || c.kind === kind) &&
        (!needle || `${c.name} ${c.summary} ${c.server ?? ""}`.toLowerCase().includes(needle)))
    },

    /** Raw transcript text: "main.jsonl" (or "<id>.jsonl") or "agent-<id>.jsonl". Anything else is null. */
    async getSession(id, name) {
      if (!isSessionName(name)) return null
      const s = locate(id)
      if (!s) return null
      let file = null
      if (name === "main.jsonl" || name === `${s.id}.jsonl`) file = s.file
      else {
        const m = /^agent-([\w-]+)\.jsonl$/.exec(name)
        if (m) file = join(root, s.slug, s.id, "subagents", `agent-${m[1]}.jsonl`)
      }
      const c = file && confined(file)
      return c ? capText(readFileSync(c.real)) : null
    },

    /** Rows from the background scan; partial while `usageStatus().complete` is false. */
    async usage(range = {}) {
      scanner.kick()
      return scanner.rows(range)
    },
    usageStatus: () => scanner.status(),
    /** Resolves when the running usage scan (if any) has finished. */
    whenScanned: () => scanner.idle(),
    /** Server start: fill the list cache and begin the usage scan without blocking the caller. */
    async warm() {
      await new Promise((r) => setImmediate(r))
      try { await this.listItems() } catch { /* a bad file must not stop the scan */ }
      scanner.kick()
    },

    describe: () => ({ source: root }),
  }
}

export default create
