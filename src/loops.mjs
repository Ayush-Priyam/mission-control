// Looping detection: a lane that keeps retrying the same failing thing is the expensive kind of stuck.
// detectLoop and sinceLastChange are pure (readLoopConfig is the one file read). Input is a lane's calls (and, for v1 runs, its events turned into calls) plus
// its token-bearing messages; output says whether it is looping now, since when, and what it cost since.
import { readFileSync, statSync } from "node:fs"

/** Thresholds; ~/.mission-control/config.json {"loops": {...}} overrides any of them. */
export const LOOP_DEFAULTS = Object.freeze({
  repeat: 4, // (a) the same tool + command fails this many times in a row
  cycles: 4, // (b) the same check fails with the same error head this many times, with edits in between
  minutes: 10, // (c) this long since the last file change ...
  tokens: 300_000, // (c) ... and this many tokens since it, with no passing check
})

/** The `loops` block of config.json merged over the defaults (bad or missing values keep the default). */
export function loopConfig(raw) {
  const out = { ...LOOP_DEFAULTS }
  if (raw && typeof raw === "object") {
    for (const k of Object.keys(LOOP_DEFAULTS)) {
      const v = raw[k]
      if (typeof v === "number" && Number.isFinite(v) && v > 0) out[k] = v
    }
  }
  return out
}

/** Read the thresholds from a config.json path (null or unreadable: defaults). */
export function readLoopConfig(path) {
  if (!path) return loopConfig(null)
  try { return loopConfig(JSON.parse(readFileSync(path, "utf8"))?.loops) } catch { return loopConfig(null) }
}

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "apply_patch", "edit", "write", "write_file", "edit_file", "str_replace_based_edit_tool"])
const CHECK = /\b(test|tests|jest|vitest|pytest|mocha|ava|rspec|phpunit|ctest|tsc|typecheck|type-check|lint|eslint|ruff|mypy|pyright|clippy|build|compile|check|gradlew?|make|go\s+(test|build|vet)|cargo\s+(test|build|check|clippy)|swift\s+(test|build)|xcodebuild|mvn|dotnet\s+(test|build))\b/i

const str = (v) => (typeof v === "string" ? v : "")
const ms = (ts) => { const t = Date.parse(str(ts)); return Number.isFinite(t) ? t : NaN }

/** A call's command, normalised: whitespace collapsed, trimmed. Bash-like calls use input.command. */
export function commandOf(call) {
  const cmd = call?.input && typeof call.input === "object" ? call.input.command ?? call.input.cmd : undefined
  const raw = Array.isArray(cmd) ? cmd.join(" ") : typeof cmd === "string" ? cmd : str(call?.summary)
  return raw.replace(/\s+/g, " ").trim()
}

/** tool + normalised command: what "the same call" means. */
const keyOf = (c) => `${c.name}\u0000${commandOf(c)}`

/** A call that changed files and did not fail. */
export function isFileChange(call) {
  return !!call && EDIT_TOOLS.has(call.name) && call.ok !== false
}

/** A test, build, lint or typecheck run (or a v1 run's stage end). */
export function isCheck(call) {
  if (!call) return false
  if (call.check === true) return true
  return CHECK.test(commandOf(call)) && !EDIT_TOOLS.has(call.name)
}

/** The first meaningful line of an error, digits masked, so "same failure" survives timings and counts. */
export function errorHead(error) {
  const line = str(error).split("\n").map((l) => l.trim()).find((l) => l && !/^(exit code|error:?)\s*\d*$/i.test(l)) ?? str(error).trim()
  return line.replace(/\d+(\.\d+)?/g, "#").slice(0, 120)
}

const tokensOf = (m) => (typeof m?.tokens === "number" ? m.tokens : 0)

/**
 * Tokens consumed since the last file change (a successful Edit/Write/MultiEdit/apply_patch...), and how
 * long ago that was. A failed edit changes nothing, so it does not reset. With no change at all, it counts
 * from the first message. `end` is the time to measure to (now for a live lane, its last activity else).
 * { tokens, since: iso|null, ms }.
 */
export function sinceLastChange({ calls = [], messages = [], end = Date.now() } = {}) {
  let at = NaN
  for (const c of calls) if (isFileChange(c) && Number.isFinite(ms(c.ts))) at = Math.max(Number.isFinite(at) ? at : -Infinity, ms(c.ts))
  const from = Number.isFinite(at) ? at : Math.min(...messages.map((m) => ms(m.ts)).filter(Number.isFinite), ...calls.map((c) => ms(c.ts)).filter(Number.isFinite))
  let tokens = 0
  for (const m of messages) if (!Number.isFinite(at) || ms(m.ts) > at) tokens += tokensOf(m)
  const since = Number.isFinite(from) ? new Date(from).toISOString() : null
  return { tokens, since, ms: since ? Math.max(0, end - from) : 0 }
}

const short = (s, n = 48) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const label = (c) => {
  const cmd = commandOf(c)
  return short(cmd && cmd !== c.name ? cmd : c.name)
}
const k = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n))

/**
 * Is this lane looping now? Calls in order (each { id, ts, name, input?, summary, ok?, error? }); messages
 * { ts, tokens, cost } for tokens and cost since. Rules, first match wins:
 *  (a) repeat: the last `repeat` finished calls are the same tool + command, all failed;
 *  (b) cycle:  the same check failed with the same error head `cycles` times, with a file change between
 *      each failure and the next, and it has not passed since;
 *  (c) burn:   `minutes` and `tokens` since the last file change, no passing check since, and at least
 *      one failed call in that stretch (a quiet read-only exploration is not a loop).
 * A failing command that then passes, or different commands failing, is not looping.
 * { looping: false } or { looping: true, rule, since, failures, costSince, firstCallId, reason, command }.
 */
export function detectLoop({ calls = [], messages = [], now = Date.now(), config = LOOP_DEFAULTS } = {}) {
  const cfg = loopConfig(config)
  const done = calls.filter((c) => c && (c.ok === true || c.ok === false))
  // From a failing call: its own turn counts. From a file change: only what came after it (as sinceLastChange).
  const costSince = (since, after = false) => {
    const from = ms(since)
    let cost = 0
    for (const m of messages) if (!Number.isFinite(from) || (after ? ms(m.ts) > from : ms(m.ts) >= from)) cost += typeof m.cost === "number" ? m.cost : 0
    return Math.round(cost * 100) / 100
  }
  const hit = (rule, first, failures, reason, command) => ({
    looping: true, rule, since: first.ts, failures, costSince: costSince(first.ts), firstCallId: first.id, reason, command,
  })

  // (a) the tail of finished calls: one key, all failed
  let n = 0
  for (let i = done.length - 1; i >= 0 && done[i].ok === false && keyOf(done[i]) === keyOf(done.at(-1)); i--) n++
  if (n >= cfg.repeat) {
    const first = done[done.length - n]
    return hit("repeat", first, n, `${label(first)} failed ${n}×`, label(first))
  }

  // (b) per check key: failures with the same error head, an edit between each; a pass clears the key
  const open = new Map() // key -> { first, head, count, edited }
  for (const c of done) {
    if (isFileChange(c)) { for (const e of open.values()) e.edited = true; continue }
    if (!isCheck(c)) continue
    const key = keyOf(c)
    if (c.ok === true) { open.delete(key); continue }
    const head = errorHead(c.error)
    const e = open.get(key)
    if (e && e.head === head) {
      if (e.edited) { e.count++; e.edited = false }
    } else open.set(key, { first: c, head, count: 1, edited: false })
  }
  let cyc = null
  for (const e of open.values()) if (e.count >= cfg.cycles && (!cyc || e.count > cyc.count)) cyc = e
  if (cyc) return hit("cycle", cyc.first, cyc.count, `${label(cyc.first)} failed ${cyc.count}× after edits`, label(cyc.first))

  // (c) tokens and minutes since the last file change, nothing passing since
  const s = sinceLastChange({ calls, messages, end: now })
  if (s.since && s.tokens >= cfg.tokens && s.ms >= cfg.minutes * 60_000) {
    const from = ms(s.since)
    const after = done.filter((c) => ms(c.ts) >= from)
    const passed = after.some((c) => c.ok === true && isCheck(c))
    const failed = after.filter((c) => c.ok === false)
    if (!passed && failed.length) {
      const first = failed[0]
      return { ...hit("burn", first, failed.length, `${k(s.tokens)} tok since the last file change, no passing check`, label(first)), since: s.since, costSince: costSince(s.since, calls.some(isFileChange)) }
    }
  }
  return { looping: false }
}

/**
 * A v1 run's events for one stage as calls loops can read: `progress` is a call (tool, detail); an `issue`
 * fails the call before it (or stands as a failed call of its own); `stage.end` is a check that passed or
 * failed. `session` events become messages (tokens, cost).
 */
export function runCalls(events, stage) {
  const calls = [], messages = []
  let last = null
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0)
  events.forEach((e, i) => {
    if (!e || typeof e !== "object" || (stage !== undefined && e.stage !== stage)) return
    const ts = str(e.ts)
    if (e.type === "progress") {
      last = { id: `${str(e.stage)}:${i}`, ts, name: str(e.tool) || "progress", summary: str(e.detail) || str(e.tool), input: undefined, ok: true }
      calls.push(last)
    } else if (e.type === "issue") {
      const error = str(e.summary) || str(e.detail) || "issue"
      if (last && last.ok !== false) { last.ok = false; last.error = error }
      else calls.push(last = { id: `${str(e.stage)}:${i}`, ts, name: "issue", summary: errorHead(error), ok: false, error })
    } else if (e.type === "stage.end") {
      calls.push(last = { id: `${str(e.stage)}:${i}`, ts, name: "stage", summary: `stage ${str(e.stage)}`, check: true, ok: e.ok !== false, ...(e.ok === false ? { error: str(e.reason) || "stage failed" } : {}) })
    } else if (e.type === "session") {
      const t = e.tokens && typeof e.tokens === "object" ? e.tokens : {}
      messages.push({ ts, tokens: num(t.input_tokens) + num(t.output_tokens) + num(t.cache_read_input_tokens) + num(t.cache_creation_input_tokens), cost: num(e.cost) })
    }
  })
  return { calls, messages }
}

/** Parsed per-message usage ({ model, ts, tokens: { in, out, cacheRead, cacheWrite } }) as { ts, tokens, cost }. */
export function tokenMessages(messages, costOf) {
  return (messages ?? []).map((m) => {
    const t = m.tokens ?? {}
    const sum = (t.in ?? 0) + (t.out ?? 0) + (t.cacheRead ?? 0) + (t.cacheWrite ?? 0)
    return { ts: m.ts, tokens: sum, cost: costOf ? costOf(m.model, t) : 0 }
  })
}

/**
 * Loop state for an item's lanes, in place. `parts`: [{ lane, calls, messages }] (messages as tokenMessages).
 * Every lane gets `sinceChange` ({ tokens, since, ms }: tokens and time since its last file change; time runs
 * to now while it works, else to its end). A working lane that loops becomes "looping" with `loop`.
 * `detect` false (the item waits on you or is ready) computes sinceChange only.
 * Returns the item's own { sinceChange, loop } (loop: the first looping lane's, or null).
 */
export function applyLoops(parts, { now = Date.now(), config = LOOP_DEFAULTS, detect = true } = {}) {
  let loop = null
  const endOf = (lane) => (lane.status === "working" ? now : Number.isFinite(ms(lane.endedAt)) ? ms(lane.endedAt) : now)
  for (const { lane, calls, messages } of parts) {
    lane.sinceChange = sinceLastChange({ calls, messages, end: endOf(lane) })
    if (!detect || lane.status !== "working") continue
    const l = detectLoop({ calls, messages, now, config })
    if (!l.looping) continue
    lane.status = "looping"
    lane.loop = { ...l, lane: lane.id }
    loop ??= lane.loop
  }
  const busy = parts.some(({ lane }) => lane.status === "working" || lane.status === "looping")
  const end = busy ? now : Math.max(...parts.map(({ lane }) => endOf(lane)), 0) || now
  const sinceChange = sinceLastChange({ calls: parts.flatMap((p) => p.calls).sort((a, b) => str(a.ts).localeCompare(str(b.ts))), messages: parts.flatMap((p) => p.messages), end })
  return { sinceChange, loop }
}

/** A config getter for a config.json path: re-read only when the file's mtime changes. */
export function createLoopConfig(path, stat = statSync) {
  let key = null, value = loopConfig(null)
  return () => {
    if (!path) return value
    let k = "missing"
    try { const st = stat(path); k = `${st.mtimeMs}|${st.size}` } catch { /* no config file */ }
    if (k !== key) { key = k; value = readLoopConfig(path) }
    return value
  }
}
