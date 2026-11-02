import { closeSync, openSync, readSync, readdirSync, realpathSync, statSync } from "node:fs"
import { join, sep } from "node:path"
import { askOf, createWaitingReader, readyOf } from "../../hooks.mjs"
import { capText, isSessionName } from "../../names.mjs"
import { createCache } from "../claude-code/cache.mjs"
import { costOf } from "../claude-code/prices.mjs"
import { LOOP_DEFAULTS, applyLoops, tokenMessages } from "../../loops.mjs"
import { createTail, parseFileWith } from "../claude-code/tail.mjs"
import { createUsageScanner } from "../claude-code/usage.mjs"
import { peek, rolloutAcc, turnsAcc } from "./parse.mjs"

const LIVE_MS = 2 * 60 * 1000
const READY_TURN_MS = 30 * 60 * 1000
const TAIL_BYTES = 64 * 1024
const WAIT_EXPIRY_MS = 12 * 3600 * 1000
const CLEAR_GAP_MS = 2000
const HEAD_BYTES = 64 * 1024
const HEAD_MAX = 1024 * 1024 // read forward this far for the session_meta and the first user message
const SESSIONS = 256
const SESSION_TEXT = 200_000
const SAFE = /^[\w-][\w.-]*$/
const ROLLOUT = /^rollout-[\w.-]+\.jsonl$/
const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i
const zero = () => ({ in: 0, out: 0, cacheRead: 0, cacheWrite: 0 })
const add = (a, b) => { a.in += b.in; a.out += b.out; a.cacheRead += b.cacheRead; a.cacheWrite += b.cacheWrite }
const iso = (ms) => new Date(ms).toISOString()

/** The thread id a rollout file name carries ("rollout-<time>-<uuid>.jsonl"); else the name without its prefix. */
export const idOfName = (name) => UUID.exec(name)?.[1] ?? name.replace(/^rollout-/, "").replace(/\.jsonl$/, "")

/**
 * Codex CLI sessions as a v2 source. `root` is the sessions dir (default ~/.codex/sessions), holding
 * YYYY/MM/DD/rollout-*.jsonl. A rollout whose session_meta names a parent thread (a spawned subagent) is
 * shown as a lane of its root session, not as an item of its own. `hooksDir` is the level-1 hook log dir:
 * Codex hook lines live in <hooksDir>/codex/<session_id>.jsonl (written by `mission-control hook codex`).
 * Read-only; every file read is confined to the real path of `root`.
 */
export function create({ root, now = () => Date.now(), hooksDir, cachePath, onParse, loops = () => LOOP_DEFAULTS } = {}) {
  const cache = createCache()
  const sessions = createCache(SESSIONS)
  const turned = createCache(8)
  const readWaiting = createWaitingReader()
  const codexHooks = hooksDir ? join(hooksDir, "codex") : null
  const lastTurns = createCache(4096)
  const peeked = new Map() // real path -> { ino, size, h }: the head of an append-only file does not change
  const opened = new Map()
  let realRoot = null
  const rootReal = () => (realRoot ??= realpathSync(root))

  function confined(file) {
    try {
      const real = realpathSync(file)
      if (!real.startsWith(rootReal() + sep)) return null
      const st = statSync(real)
      return st.isFile() ? { real, st } : null
    } catch { return null }
  }

  function head(file, bytes, raw = false) {
    let fd
    try {
      fd = openSync(file, "r")
      const buf = Buffer.alloc(bytes)
      const n = readSync(fd, buf, 0, bytes, 0)
      return raw ? buf.subarray(0, n) : buf.toString("utf8", 0, n)
    } finally { if (fd !== undefined) closeSync(fd) }
  }

  const dirs = (p) => { try { return readdirSync(p, { withFileTypes: true }) } catch { return [] } }
  const sub = (p, re) => dirs(p).filter((d) => d.isDirectory() && re.test(d.name)).map((d) => d.name).sort()

  /** Every rollout on disk: { id, file } for root/YYYY/MM/DD/rollout-*.jsonl. */
  function rolloutFiles() {
    const out = []
    for (const y of sub(root, /^\d{4}$/)) for (const m of sub(join(root, y), /^\d{2}$/)) for (const d of sub(join(root, y, m), /^\d{2}$/)) {
      const dir = join(root, y, m, d)
      for (const f of dirs(dir)) if (f.isFile() && ROLLOUT.test(f.name)) out.push({ id: idOfName(f.name), file: join(dir, f.name) })
    }
    return out
  }

  /** Head peek, re-read only when the file is new, replaced, or grew while its head still lacked a title. */
  function peekFile(c) {
    const hit = peeked.get(c.real)
    if (hit && hit.ino === c.st.ino && (hit.size === c.st.size || (hit.h.meta && hit.h.title))) return hit.h
    let h = peek(head(c.real, HEAD_BYTES))
    if ((!h.meta || !h.title) && c.st.size > HEAD_BYTES) h = peek(head(c.real, Math.min(c.st.size, HEAD_MAX)))
    if (peeked.size > 16384) peeked.delete(peeked.keys().next().value)
    peeked.set(c.real, { ino: c.st.ino, size: c.st.size, h })
    return h
  }

  /**
   * Every rollout with stat and head: { id, file, c, h, parent }. Subagent rollouts point at their parent
   * thread; a parent that is not on disk leaves the rollout standing as its own item.
   */
  function scan() {
    const all = []
    for (const r of rolloutFiles()) {
      const c = confined(r.file)
      if (!c) continue
      let h
      try { h = peekFile(c) } catch { continue }
      all.push({ ...r, c, h, parent: h.meta?.parent ?? null })
    }
    const byId = new Map(all.map((r) => [r.id, r]))
    const kids = new Map()
    for (const r of all) {
      if (!r.parent || r.parent === r.id || !byId.has(r.parent)) { r.parent = null; continue }
      if (!kids.has(r.parent)) kids.set(r.parent, [])
      kids.get(r.parent).push(r)
    }
    /** The root item of a rollout (walks parent links; a loop stops at the first repeat). */
    const rootOf = (r) => { const seen = new Set(); while (r.parent && !seen.has(r.id)) { seen.add(r.id); r = byId.get(r.parent) } return r }
    /** Every descendant of a root rollout, parents before children, each with its parent id. */
    const descendants = (id) => {
      const out = [], q = [id], seen = new Set([id])
      while (q.length) for (const k of kids.get(q.shift()) ?? []) if (!seen.has(k.id)) { seen.add(k.id); out.push(k); q.push(k.id) }
      return out
    }
    return { all, byId, rootOf, descendants }
  }

  const liveAt = (ms) => now() - ms <= LIVE_MS

  /** Newest response item or typed user message (ms) in the tail of a rollout: the session moved on. */
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
          if (j && (j.type === "response_item" || (j.type === "event_msg" && j.payload?.type === "user_message"))) best = Math.max(best, Date.parse(j.timestamp) || 0)
        } catch { /* half-written or cut first line */ }
      }
      return best
    } catch { return 0 } finally { if (fd !== undefined) closeSync(fd) }
  }

  /** Hook-derived state for a root rollout, keyed by its id and its session_id: { waiting, message } or { ready } or null. */
  function waitingOf(r, logged) {
    if (!codexHooks) return null
    const keys = [...new Set([r.id, r.h.meta?.sessionId].filter((k) => typeof k === "string" && SAFE.test(k)))]
    let w = null
    for (const k of keys) {
      if (logged && !logged.has(`${k}.jsonl`)) continue
      const x = readWaiting(codexHooks, k)
      if (x.waiting || x.ready) { w = x; break }
    }
    if (!w) return null
    const since = Date.parse(w.since)
    if (Number.isFinite(since)) {
      if (now() - since > WAIT_EXPIRY_MS) return null
      // A finished turn counts as ready for 30 minutes; after that the session is just idle.
      if (w.turnEnd && now() - since > READY_TURN_MS) return null
      const k = cache.key(r.c.real, r.c.st)
      const last = lastTurns.get(k) ?? lastTurns.set(k, lastTurnMs(r.c.real, r.c.st.size))
      if (last > since + CLEAR_GAP_MS) return null
    }
    return w
  }

  function laneOf(p, { id, label, kind, parent, live }) {
    const lane = { id, label, kind, status: live ? "working" : "idle", calls: p.calls.length, errors: p.errors, tokens: p.tokens, cost: p.cost }
    if (p.firstModel) lane.model = p.firstModel
    if (parent) lane.parent = parent
    if (p.nowDoing && live) lane.nowDoing = p.nowDoing
    if (p.firstTs) lane.startedAt = p.firstTs
    if (p.lastTs && !live) lane.endedAt = p.lastTs
    return lane
  }

  const parseOf = (lane) => () => rolloutAcc(lane, costOf)

  /** Parsed files of one root session, rebuilt only when one of its rollouts changed (appends read incrementally). */
  function parsed(r, kids) {
    const id = (c) => `${c.real}|${c.st.ino}|${c.st.size}|${c.st.mtimeMs}`
    const stamp = [id(r.c), ...kids.map((k) => id(k.c))].join("\n")
    const prev = sessions.get(r.id)
    if (prev && prev.stamp === stamp) return prev.data
    const tails = new Map()
    const read = (c, lane) => {
      const t = prev?.tails.get(c.real) ?? createTail(parseOf(lane), onParse)
      try { t.update(c.real, c.st) } catch { return null }
      tails.set(c.real, t)
      return t.result()
    }
    const mp = read(r.c, "main")
    if (!mp) return null
    const subs = []
    for (const k of kids) {
      const p = read(k.c, `agent-${k.id}`)
      if (p) subs.push({ k, p, mt: k.c.st.mtimeMs })
    }
    const calls = [...mp.calls]
    for (const a of subs) calls.push(...a.p.calls)
    calls.sort((x, y) => x.ts.localeCompare(y.ts))
    const lastMs = Math.max(r.c.st.mtimeMs, ...subs.map((a) => a.mt))
    const data = { mp, subs, calls, lastMs }
    sessions.set(r.id, { stamp, tails, data })
    return data
  }

  function titleOf(meta, fallback) { return meta?.title ?? fallback }

  function load(r, kids) {
    const d = parsed(r, kids)
    if (!d) return null
    const { mp, subs, calls, lastMs } = d
    const lanes = [laneOf(mp, { id: "main", label: "main", kind: "main", live: liveAt(r.c.st.mtimeMs) })]
    for (const a of subs) {
      const m = a.p.meta
      const label = m.nickname ?? m.role ?? m.path ?? a.k.id
      const parent = a.k.parent === r.id ? "main" : `agent-${a.k.parent}`
      lanes.push({ ...laneOf(a.p, { id: `agent-${a.k.id}`, label, kind: "subagent", parent, live: liveAt(a.mt) }), ...(m.role ? { agentType: m.role } : {}) })
    }
    const tokens = zero()
    let cost = 0, errors = 0
    for (const l of lanes) { add(tokens, l.tokens); cost += l.cost; errors += l.errors }
    const running = liveAt(lastMs)
    const w = waitingOf(r)
    const parts = [{ lane: lanes[0], calls: mp.calls, messages: tokenMessages(mp.messages, costOf) }, ...subs.map((a, i) => ({ lane: lanes[i + 1], calls: a.p.calls, messages: tokenMessages(a.p.messages, costOf) }))]
    const lp = applyLoops(parts, { now: now(), config: loops(), detect: !w?.waiting && !w?.ready })
    if (w?.waiting) { lanes[0].status = "waiting"; lanes[0].reason = w.message ?? "Waiting for you"; lanes[0].ask = askOf(w) }
    else if (w?.ready) { lanes[0].status = "idle"; lanes[0].reason = "ready for input" }
    const meta = mp.meta
    const summary = {
      source: "codex", id: r.id, kind: "session",
      title: titleOf(meta, r.h.title ?? r.id), harness: "codex",
      cwd: meta.cwd ?? r.h.meta?.cwd ?? null, branch: meta.branch ?? r.h.meta?.branch ?? null,
      live: running && !w?.ready, status: w?.waiting ? "waiting" : w?.ready ? "idle" : running ? (lp.loop ? "looping" : "working") : "idle", waiting: !!w?.waiting,
      startedAt: meta.startedAt ?? mp.firstTs, updatedAt: iso(lastMs),
      counts: { lanes: lanes.length, calls: calls.length, errors },
      tokens, cost,
      sinceChange: lp.sinceChange,
      ...(lp.loop ? { loop: lp.loop } : {}),
      ...readyOf(w),
    }
    if (meta.version) summary.version = meta.version
    opened.set(r.id, { lastMs, summary })
    return { summary, lanes, calls, events: [] }
  }

  /** A root item by id with its subagent rollouts, or null (subagent ids are not items of their own). */
  function locate(id) {
    if (typeof id !== "string" || !SAFE.test(id)) return null
    const s = scan()
    const r = s.byId.get(id)
    if (!r || r.parent) return null
    return { r, kids: s.descendants(id), s }
  }

  function usageFiles() {
    const s = scan()
    return s.all.map((r) => ({ session: s.rootOf(r).id, main: !r.parent, file: r.c.real, st: r.c.st }))
  }
  const scanner = createUsageScanner({ source: "codex", files: usageFiles, parseFile: (file, st) => parseFileWith(parseOf("main"), file, st), costOf, cachePath, now })

  return {
    name: "codex",
    harness: "codex",

    /** stat + the head of each rollout only; totals appear once a session has been opened. */
    async listItems() {
      const s = scan()
      const logged = new Set(codexHooks ? dirs(codexHooks).map((d) => d.name) : [])
      const items = []
      for (const r of s.all) {
        if (r.parent) continue
        try {
          const kids = s.descendants(r.id)
          const lastMs = Math.max(r.c.st.mtimeMs, ...kids.map((k) => k.c.st.mtimeMs))
          const o = opened.get(r.id)
          const done = o && o.lastMs === lastMs ? o.summary : null
          const live = liveAt(lastMs)
          const w = waitingOf(r, logged)
          const m = r.h.meta
          items.push({
            source: "codex", id: r.id, kind: "session",
            title: r.h.title ?? r.id, harness: "codex",
            cwd: m?.cwd ?? null, branch: m?.branch ?? null,
            live: live && !w?.ready, status: w?.waiting ? "waiting" : w?.ready ? "idle" : live ? (o?.summary.status === "looping" ? "looping" : "working") : "idle", waiting: !!w?.waiting,
            startedAt: m?.startedAt ?? r.h.startedAt, updatedAt: iso(lastMs),
            ...(o?.summary.sinceChange ? { sinceChange: o.summary.sinceChange } : {}),
            ...(live && o?.summary.loop && !w?.waiting && !w?.ready ? { loop: o.summary.loop } : {}),
            counts: { lanes: 1 + kids.length, calls: done?.counts.calls ?? 0, errors: done?.counts.errors ?? 0 },
            tokens: done?.tokens ?? zero(), cost: done?.cost ?? 0,
            ...readyOf(w),
            ...(done ? {} : { partial: true }),
          })
        } catch { /* one unreadable file must not hide the rest */ }
      }
      return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    },

    async getItem(id) {
      const l = locate(id)
      const x = l && load(l.r, l.kids)
      return x && { summary: x.summary, lanes: x.lanes, events: x.events }
    },

    async getCalls(id, { lane, kind, q } = {}) {
      const l = locate(id)
      const x = l && load(l.r, l.kids)
      if (!x) return []
      const needle = q ? String(q).toLowerCase() : null
      return x.calls.filter((c) =>
        (!lane || c.lane === lane) && (!kind || c.kind === kind) &&
        (!needle || `${c.name} ${c.summary} ${c.server ?? ""}`.toLowerCase().includes(needle)))
    },

    /** Chat turns of one lane ("main" or "agent-<thread id>"), newest page by default. */
    async getTurns(id, lane, { before, limit = 100 } = {}) {
      const l = locate(id)
      if (!l || typeof lane !== "string") return null
      const m = /^agent-([\w-]+)$/.exec(lane)
      const c = lane === "main" ? l.r.c : m ? l.kids.find((k) => k.id === m[1])?.c : null
      if (!c) return null
      const t = turned.get(c.real) ?? turned.set(c.real, createTail(turnsAcc, onParse))
      try { t.update(c.real, c.st) } catch { return null }
      const all = t.result()
      const end = Math.max(0, Math.min(all.length, Number.isInteger(before) ? before : all.length))
      const start = Math.max(0, end - Math.max(1, limit))
      return { lane, total: all.length, start, turns: all.slice(start, end) }
    },

    /** Raw rollout text: "main.jsonl" (or "<id>.jsonl") or "agent-<thread id>.jsonl". Anything else is null. */
    async getSession(id, name) {
      if (!isSessionName(name)) return null
      const l = locate(id)
      if (!l) return null
      let c = null
      if (name === "main.jsonl" || name === `${l.r.id}.jsonl`) c = l.r.c
      else {
        const m = /^agent-([\w-]+)\.jsonl$/.exec(name)
        if (m) c = l.kids.find((k) => k.id === m[1])?.c ?? null
      }
      const ok = c && confined(c.real) // re-check: the file may have been swapped since the scan
      return ok ? capText(head(ok.real, SESSION_TEXT + 1, true), SESSION_TEXT) : null
    },

    async usage(range = {}) {
      scanner.kick()
      return scanner.rows(range)
    },
    usageStatus: () => scanner.status(),
    whenScanned: () => scanner.idle(),
    async warm() {
      await new Promise((r) => setImmediate(r))
      try { await this.listItems() } catch { /* a bad file must not stop the scan */ }
      scanner.kick()
    },

    describe: () => ({ source: root }),
    usageCachePath: cachePath ?? null,
  }
}

export default create
