import { closeSync, openSync, readSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs"
import { join, sep } from "node:path"
import { UNCONFIRMED_MS, askOf, createWaitingReader, readyOf } from "../../hooks.mjs"
import { capText, isSessionName } from "../../names.mjs"
import { createCache } from "./cache.mjs"
import { parseTranscript, peek, transcriptAcc, turnsAcc } from "./parse.mjs"
import { createTail, parseFileWith } from "./tail.mjs"
import { costOf } from "./prices.mjs"
import { LOOP_DEFAULTS, applyLoops, tokenMessages } from "../../loops.mjs"
import { createUsageScanner } from "./usage.mjs"
import { turnCosts } from "../../turn-costs.mjs"

const LIVE_MS = 2 * 60 * 1000
const TAIL_BYTES = 64 * 1024
const WAIT_EXPIRY_MS = 12 * 3600 * 1000
const CLEAR_GAP_MS = 2000
const HEAD_BYTES = 64 * 1024
const HEAD_MAX = 1024 * 1024 // read forward this far for the first line carrying a cwd
const SESSIONS = 256 // parsed sessions kept, whatever their lane count
const SESSION_TEXT = 200_000 // getSession returns at most this many bytes
const SAFE = /^[\w-][\w.-]*$/ // one path segment: no separators, never starts with a dot
const zero = () => ({ in: 0, out: 0, cacheRead: 0, cacheWrite: 0 })
const add = (a, b) => { a.in += b.in; a.out += b.out; a.cacheRead += b.cacheRead; a.cacheWrite += b.cacheWrite }
const iso = (ms) => new Date(ms).toISOString()

/**
 * Claude Code sessions as a v2 source. `root` is the projects dir (default ~/.claude/projects),
 * `now` an injectable clock. `hooksDir` holds the level-1 hook logs: a session whose last Notification is
 * unanswered is "waiting" (an idle reminder is "ready", i.e. idle). Read-only; every file read is confined to the real path of `root`. `cachePath` is where the
 * usage scan persists its per-file results (omitted: memory only); `parse` (text -> parseTranscript result,
 * usage scan only) and `onParse(path, { bytes, full })` (every transcript read for items, calls and turns)
 * are for tests.
 */
export function create({ root, now = () => Date.now(), hooksDir, cachePath, parse = parseTranscript, onParse, loops = () => LOOP_DEFAULTS } = {}) {
  const cache = createCache() // key helper for the head cache below
  // id -> { stamp, tails, data }: one parse per session version (stamp = identity of all its files), shared by
  // getItem, getCalls and the overview. tails keeps each file's incremental reader, so a growing
  // transcript is parsed only for its new lines.
  const sessions = createCache(SESSIONS)
  const turned = createCache(8) // real path -> incremental parseTurns of that file, for chat paging
  const readWaiting = createWaitingReader() // hook logs, cached by size+mtime, tail-read when large
  const lastTurns = createCache(4096) // path|size|mtime -> newest turn time in the tail of a main log
  const peeked = createCache(8192) // path|size|mtime -> peek of the head, so warm lists skip file reads
  const opened = new Map() // id -> { lastMs, summary } of sessions already fully parsed, for list totals
  let liveFiles = [] // main logs of sessions live or waiting at the last listing, for /api/events
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

  /** The first `bytes` of a file as text (or as a Buffer with `raw`). */
  function head(file, bytes, raw = false) {
    let fd
    try {
      fd = openSync(file, "r")
      const buf = Buffer.alloc(bytes)
      const n = readSync(fd, buf, 0, bytes, 0)
      return raw ? buf.subarray(0, n) : buf.toString("utf8", 0, n)
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

  /** Subagent transcripts of a session: [{ aid, file, metaFile }], from the directory listing only. */
  function subagents(s) {
    const dir = join(root, s.slug, s.id, "subagents")
    const out = []
    for (const f of dirs(dir)) {
      const m = /^agent-([\w-]+)\.jsonl$/.exec(f.name)
      if (m && f.isFile()) out.push({ aid: m[1], file: join(dir, f.name), metaFile: join(dir, `agent-${m[1]}.meta.json`) })
    }
    return out.sort((a, b) => a.aid.localeCompare(b.aid))
  }

  /** A subagent's meta.json ({} when missing or broken: the lane keeps its id as label). */
  function readMeta(c) {
    try {
      const j = c && JSON.parse(readFileSync(c.real, "utf8"))
      return j && typeof j === "object" && !Array.isArray(j) ? j : {}
    } catch { return {} }
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
  // The default parser streams the file in chunks (no string size limit); an injected one gets the text.
  const parseFile = parse === parseTranscript ? (file, st) => parseFileWith(() => transcriptAcc(), file, st) : (file) => parse(readFileSync(file, "utf8"))
  const scanner = createUsageScanner({ files: usageFiles, parseFile, costOf, cachePath, now })

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
      // A subagent's PermissionRequest no Notification confirmed: it was auto-denied in a session that cannot prompt.
      if (w.tentative && now() - since > UNCONFIRMED_MS) return null
      const k = cache.key(main.real, main.st)
      const last = lastTurns.get(k) ?? lastTurns.set(k, lastTurnMs(main.real, main.st.size))
      if (last > since + CLEAR_GAP_MS) return null
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

  /**
   * The parsed files of one session, rebuilt only when one of its files (transcripts or meta) changed:
   * { main, mp, subs: [{ aid, p, meta, mt }], calls (all lanes, sorted, Agent calls linked), lastMs }.
   * A changed file is read incrementally (only appended bytes); unchanged ones are not read at all.
   */
  function parsed(s) {
    const main = confined(s.file)
    if (!main) return null
    const found = subagents(s).map((a) => ({ ...a, c: confined(a.file), m: confined(a.metaFile) })).filter((a) => a.c)
    const id = (c) => (c ? `${c.real}|${c.st.ino}|${c.st.size}|${c.st.mtimeMs}` : "-")
    const stamp = [id(main), ...found.map((a) => `${id(a.c)}>${id(a.m)}`)].join("\n")
    const prev = sessions.get(s.id)
    if (prev && prev.stamp === stamp) return prev.data
    const tails = new Map()
    const read = (c, lane) => {
      const t = prev?.tails.get(c.real) ?? createTail(() => transcriptAcc(lane), onParse)
      try { t.update(c.real, c.st) } catch { return null } // vanished or unreadable mid-read
      tails.set(c.real, t)
      return t.result()
    }
    const mp = read(main, "main")
    if (!mp) return null
    const subs = []
    const okStamp = [id(main)] // only files that were read: a failed one makes the next call's stamp differ, so it is retried
    for (const a of found) {
      const p = read(a.c, `agent-${a.aid}`)
      if (p) { subs.push({ aid: a.aid, p, meta: readMeta(a.m), mt: a.c.st.mtimeMs }); okStamp.push(`${id(a.c)}>${id(a.m)}`) }
    }
    const calls = mp.calls.map((c) => ({ ...c }))
    const byUse = new Map(calls.map((c) => [c.id, c]))
    for (const a of subs) {
      const lane = `agent-${a.aid}`
      for (const c of a.p.calls) calls.push({ ...c, lane })
      const link = typeof a.meta.toolUseId === "string" ? byUse.get(a.meta.toolUseId) : null
      if (link && link.kind === "agent") link.subLane = lane
    }
    calls.sort((x, y) => x.ts.localeCompare(y.ts))
    const lastMs = Math.max(main.st.mtimeMs, ...subs.map((a) => a.mt))
    const data = { main, mp, subs, calls, lastMs }
    sessions.set(s.id, { stamp: okStamp.length === found.length + 1 ? stamp : okStamp.join("\n"), tails, data })
    return data
  }

  /** One session: summary and lanes from the parsed files, with liveness (clock) and hook state applied now. */
  function load(s) {
    const d = parsed(s)
    if (!d) return null
    const { main, mp, subs, calls, lastMs } = d
    const live = liveAt(lastMs)
    const lanes = [laneOf(mp, { id: "main", label: "main", kind: "main", live })]
    for (const a of subs) {
      const id = `agent-${a.aid}`
      const label = typeof a.meta.description === "string" && a.meta.description ? a.meta.description : a.aid
      lanes.push({
        ...laneOf(a.p, { id, label, kind: "subagent", parent: "main", model: typeof a.meta.model === "string" ? a.meta.model : undefined, live: liveAt(a.mt), finished: a.meta.finished === true }),
        ...(typeof a.meta.agentType === "string" ? { agentType: a.meta.agentType } : {}),
      })
    }
    const tokens = zero()
    let cost = 0, errors = 0
    for (const l of lanes) { add(tokens, l.tokens); cost += l.cost; errors += l.errors }
    const running = lanes.some((l) => l.status === "working")
    const w = waitingOf(s.id, main)
    // Loops and tokens-since-last-change per lane (a session waiting on you or ready is not looping).
    const parts = [{ lane: lanes[0], calls: mp.calls, messages: tokenMessages(mp.messages, costOf) }, ...subs.map((a, i) => ({ lane: lanes[i + 1], calls: a.p.calls, messages: tokenMessages(a.p.messages, costOf) }))]
    const lp = applyLoops(parts, { now: now(), config: loops(), detect: !w?.waiting && !w?.ready })
    if (w?.waiting) {
      lanes[0].status = "waiting"
      lanes[0].reason = w.message ?? "Waiting for you"
      lanes[0].ask = askOf(w)
    } else if (w?.ready) {
      lanes[0].status = "idle"
      lanes[0].reason = "ready for input"
    }
    const summary = {
      source: "claude-code", id: s.id, kind: "session",
      title: mp.meta.title ?? s.id, harness: "claude-code",
      cwd: mp.meta.cwd, branch: mp.meta.branch,
      // A session the hooks call ready (idle reminder) is not live, whatever its file times say.
      live: running && !w?.ready, status: w?.waiting ? "waiting" : w?.ready ? "idle" : running ? (lp.loop ? "looping" : "working") : "idle", waiting: !!w?.waiting,
      startedAt: mp.firstTs, updatedAt: iso(lastMs),
      counts: { lanes: lanes.length, calls: calls.length, errors },
      tokens, cost,
      sinceChange: lp.sinceChange,
      ...(lp.loop ? { loop: lp.loop } : {}),
      ...readyOf(w),
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
      const watched = []
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
          if (live || w?.waiting) watched.push(c.real)
          items.push({
            source: "claude-code", id: s.id, kind: "session",
            title: h.title ?? s.id, harness: "claude-code",
            cwd: h.cwd, branch: h.branch,
            // Looping is known once the session was opened (the overview opens every busy one each poll).
            live: live && !w?.ready, status: w?.waiting ? "waiting" : w?.ready ? "idle" : live ? (o?.summary.status === "looping" ? "looping" : "working") : "idle", waiting: !!w?.waiting,
            startedAt: h.startedAt, updatedAt: iso(lastMs),
            ...(o?.summary.sinceChange ? { sinceChange: o.summary.sinceChange } : {}),
            ...(live && o?.summary.loop && !w?.waiting && !w?.ready ? { loop: o.summary.loop } : {}),
            counts: { lanes: 1 + subs.length, calls: done?.counts.calls ?? 0, errors: done?.counts.errors ?? 0 },
            tokens: done?.tokens ?? zero(), cost: done?.cost ?? 0,
            ...readyOf(w),
            ...(done ? {} : { partial: true }), // totals appear once the session is opened
          })
        } catch { /* one unreadable file must not hide the rest */ }
      }
      liveFiles = watched
      return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    },

    /** For /api/events: the hook log dir and the main logs of live (or waiting) sessions. */
    watchTargets: () => ({ dirs: hooksDir ? [hooksDir] : [], files: liveFiles }),

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

    /**
     * Chat turns of one lane ("main" or "agent-<id>"), newest page by default: turns [max(0, end - limit), end)
     * where end is `before` (default: all). { lane, total, start, turns } or null for an unknown session or lane.
     */
    async getTurns(id, lane, { before, limit = 100 } = {}) {
      const s = locate(id)
      if (!s || typeof lane !== "string") return null
      const m = /^agent-([\w-]+)$/.exec(lane)
      const file = lane === "main" ? s.file : m ? join(root, s.slug, s.id, "subagents", `agent-${m[1]}.jsonl`) : null
      const c = file && confined(file)
      if (!c) return null
      const t = turned.get(c.real) ?? turned.set(c.real, createTail(turnsAcc, onParse))
      try { t.update(c.real, c.st) } catch { return null }
      const all = t.result()
      const end = Math.max(0, Math.min(all.length, Number.isInteger(before) ? before : all.length))
      const start = Math.max(0, end - Math.max(1, limit))
      return { lane, total: all.length, start, turns: all.slice(start, end) }
    },

    /** Per-turn tokens, cost and compaction markers of one lane ("main" or "agent-<id>"); null when unknown. */
    async getTurnCosts(id, lane = "main") {
      const s = locate(id)
      const d = s && parsed(s)
      if (!d) return null
      const p = lane === "main" ? d.mp : d.subs.find((a) => `agent-${a.aid}` === lane)?.p
      return p ? { lane, ...turnCosts(p.messages, costOf) } : null
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
      return c ? capText(head(c.real, SESSION_TEXT + 1, true), SESSION_TEXT) : null
    },

    /** Rows from the background scan; partial while `usageStatus().complete` is false. */
    async usage(range = {}) {
      scanner.kick()
      return scanner.rows(range)
    },
    usageStatus: () => scanner.status(),
    /** 15-minute token buckets since a bucket time, from the background scan (for the usage-window estimate). */
    async usageBuckets(since) {
      scanner.kick()
      return scanner.buckets({ since })
    },
    /** Resolves when the running usage scan (if any) has finished. */
    whenScanned: () => scanner.idle(),
    /** Server start: fill the list cache and begin the usage scan without blocking the caller. */
    async warm() {
      await new Promise((r) => setImmediate(r))
      try { await this.listItems() } catch { /* a bad file must not stop the scan */ }
      scanner.kick()
    },

    describe: () => ({ source: root }),
    /** The usage cache file (null: memory only). */
    usageCachePath: cachePath ?? null,
  }
}

export default create
