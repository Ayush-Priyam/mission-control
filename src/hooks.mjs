import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, readSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

/** Claude Code hook events the dashboard listens to. */
export const EVENTS = ["Notification", "Stop", "SubagentStop", "UserPromptSubmit", "PreToolUse"]
const SAFE_ID = /^[\w-][\w.-]*$/
const CLEARS = new Set(["PreToolUse", "UserPromptSubmit", "Stop"])
const MAX_MESSAGE = 500

export const defaultHooksDir = (home = homedir()) => join(home, ".mission-control", "hooks")

/**
 * Append one hook event to <hooksDir>/<session_id>.jsonl (dir 0700, file 0600). Synchronous and local,
 * and never throws: it runs inside the user's Claude Code session. True when a line was written.
 */
export function recordHook({ raw, event, hooksDir = defaultHooksDir(), now = () => new Date() }) {
  try {
    const input = JSON.parse(raw)
    if (!input || typeof input !== "object") return false
    const sessionId = input.session_id
    const name = typeof input.hook_event_name === "string" ? input.hook_event_name : event
    if (typeof sessionId !== "string" || !SAFE_ID.test(sessionId) || !EVENTS.includes(name)) return false
    const line = { event: name, sessionId, ts: now().toISOString() }
    if (typeof input.message === "string") line.message = input.message.slice(0, MAX_MESSAGE)
    if (typeof input.tool_name === "string") line.tool = input.tool_name
    mkdirSync(hooksDir, { recursive: true, mode: 0o700 })
    appendFileSync(join(hooksDir, `${sessionId}.jsonl`), JSON.stringify(line) + "\n", { mode: 0o600 })
    return true
  } catch { return false }
}

/** Parse hook log text (or an array of lines) into events, skipping blank or half-written lines. */
export function parseHookLines(lines) {
  const list = typeof lines === "string" ? lines.split("\n") : lines
  const out = []
  for (const l of list) {
    if (typeof l === "object" && l) { out.push(l); continue }
    try { const j = JSON.parse(l); if (j && typeof j === "object") out.push(j) } catch { /* skip */ }
  }
  return out
}

/** Claude Code's idle reminder, fired about a minute after a turn ends: the session is ready, not blocked. */
export const IDLE_MESSAGE = /waiting for your input/i

/**
 * Waiting = a Notification with no PreToolUse / UserPromptSubmit / Stop after it (log order). A Notification
 * that carries a `callId` (Codex PermissionRequest for one tool call) is a wait of its own: only a tool event
 * for the same call id, a tool event with no id, a new prompt or Stop clears it, so a sibling tool running in
 * parallel never clears it. An unkeyed Notification replaces every open wait (Claude's rule). The newest open
 * wait is reported. An idle reminder is `ready: true` with `waiting: false`. Takes parsed events or raw lines.
 * { waiting, ready?, message?, since? }.
 */
export function waitingFromHooks(lines) {
  const events = parseHookLines(lines)
  const open = new Map() // callId ("" for unkeyed) -> Notification, in arrival order
  for (const e of events) {
    const id = typeof e.callId === "string" && e.callId ? e.callId : ""
    if (e.event === "Notification") {
      if (!id) open.clear()
      open.delete(id)
      open.set(id, e)
    } else if (CLEARS.has(e.event)) {
      if (e.event === "PreToolUse" && id) { open.delete(id); open.delete("") } else open.clear()
    }
  }
  const n = [...open.values()].at(-1)
  if (!n) return { waiting: false }
  const ready = typeof n.message === "string" && IDLE_MESSAGE.test(n.message)
  const out = ready ? { waiting: false, ready: true } : { waiting: true }
  if (typeof n.message === "string") out.message = n.message
  if (typeof n.ts === "string") out.since = n.ts
  // The oldest still-open keyed wait is what blocks the session: report it, with its call id.
  const first = [...open.values()][0]
  if (first !== n && first.callId) { if (typeof first.message === "string") out.message = first.message; if (typeof first.ts === "string") out.since = first.ts }
  const shown = first !== n && first.callId ? first : n
  if (typeof shown.callId === "string" && shown.callId) out.callId = shown.callId
  return out
}

/** Read a session's hook state from disk; { waiting: false } when there is no log. */
export function readWaiting(hooksDir, sessionId) {
  try { return waitingFromHooks(readFileSync(join(hooksDir, `${sessionId}.jsonl`), "utf8")) } catch { return { waiting: false } }
}

const HOOK_TAIL = 64 * 1024
const CACHED_LOGS = 8192

/**
 * readWaiting with a per-file cache keyed by size+mtime: an unchanged log is not read again. A log over
 * `tailBytes` is read from its tail only; the tail decides when it holds a Notification or a clearing
 * event (the cut first line is skipped), else the whole log is read. `onRead(path, { bytes })` is for tests.
 */
export function createWaitingReader({ tailBytes = HOOK_TAIL, onRead } = {}) {
  const cache = new Map() // path -> { key, value }
  function read(path, size) {
    const fd = openSync(path, "r")
    try {
      const n = Math.min(size, tailBytes)
      const buf = Buffer.alloc(n)
      const got = readSync(fd, buf, 0, n, size - n)
      onRead?.(path, { bytes: got })
      const text = buf.toString("utf8", 0, got)
      if (n === size) return waitingFromHooks(text)
      const events = parseHookLines(text.slice(text.indexOf("\n") + 1))
      // The tail decides only when it holds an event that resets every wait; a keyed event alone could
      // leave an older open wait before the tail, so that needs the whole log.
      if (events.some((e) => (e.event === "Notification" || CLEARS.has(e.event)) && !e.callId)) return waitingFromHooks(events)
    } finally { closeSync(fd) }
    onRead?.(path, { bytes: size })
    return waitingFromHooks(readFileSync(path, "utf8"))
  }
  return function readWaitingCached(hooksDir, sessionId) {
    const path = join(hooksDir, `${sessionId}.jsonl`)
    let st
    try { st = statSync(path) } catch { cache.delete(path); return { waiting: false } }
    const key = `${st.ino}|${st.size}|${st.mtimeMs}`
    const hit = cache.get(path)
    if (hit && hit.key === key) return hit.value
    let value
    try { value = read(path, st.size) } catch { value = { waiting: false } }
    if (cache.size >= CACHED_LOGS) cache.delete(cache.keys().next().value)
    cache.set(path, { key, value })
    return value
  }
}

/** The settings.json block to merge by hand; `node` and the script are absolute. */
export function settingsBlock({ node = process.execPath, script }) {
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`
  const hooks = {}
  for (const e of EVENTS) hooks[e] = [{ hooks: [{ type: "command", command: `${q(node)} ${q(script)} hook ${e}` }] }]
  return { hooks }
}

/**
 * Codex CLI hook events (hooks.json / [hooks] in ~/.codex/config.toml) and the dashboard event each is
 * recorded as, so one waiting rule serves both harnesses: PermissionRequest (Codex is about to ask for
 * approval) opens a wait like a Claude Notification; a tool starting or finishing, a new prompt, the turn
 * ending or an interrupt clears it.
 */
export const CODEX_EVENTS = {
  PermissionRequest: "Notification",
  PreToolUse: "PreToolUse",
  PostToolUse: "PreToolUse",
  UserPromptSubmit: "UserPromptSubmit",
  Stop: "Stop",
  Interrupt: "Stop",
  SubagentStop: "SubagentStop",
}

/**
 * Append one Codex hook event to <hooksDir>/codex/<session_id>.jsonl in the same line format as Claude's
 * (`event` is the mapped name, `codexEvent` the original). Never throws; true when a line was written.
 */
export function recordCodexHook({ raw, hooksDir = defaultHooksDir(), now = () => new Date() }) {
  try {
    const input = JSON.parse(raw)
    if (!input || typeof input !== "object") return false
    const sessionId = input.session_id
    const name = input.hook_event_name
    if (typeof sessionId !== "string" || !SAFE_ID.test(sessionId) || typeof name !== "string" || !Object.hasOwn(CODEX_EVENTS, name)) return false
    const line = { event: CODEX_EVENTS[name], codexEvent: name, sessionId, ts: now().toISOString() }
    if (typeof input.tool_name === "string") line.tool = input.tool_name
    // The tool call this event is about, so parallel tools keep separate waits (see waitingFromHooks).
    const callId = [input.tool_use_id, input.call_id, input.tool_call_id].find((v) => typeof v === "string" && SAFE_ID.test(v) && v.length <= 128)
    if (callId) line.callId = callId
    if (name === "PermissionRequest") {
      const what = typeof input.tool_input?.description === "string" ? input.tool_input.description : ""
      const tool = typeof input.tool_name === "string" ? input.tool_name : "a tool"
      line.message = `Codex needs your approval to use ${tool}${what ? `: ${what}` : ""}`.slice(0, MAX_MESSAGE)
    }
    const dir = join(hooksDir, "codex")
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    appendFileSync(join(dir, `${sessionId}.jsonl`), JSON.stringify(line) + "\n", { mode: 0o600 })
    return true
  } catch { return false }
}

/** The hooks.json block for Codex (merge into ~/.codex/hooks.json by hand); `node` and the script are absolute. */
export function codexHooksBlock({ node = process.execPath, script }) {
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`
  const hooks = {}
  for (const e of Object.keys(CODEX_EVENTS)) hooks[e] = [{ hooks: [{ type: "command", command: `${q(node)} ${q(script)} hook codex`, timeout: 10 }] }]
  return { hooks }
}
