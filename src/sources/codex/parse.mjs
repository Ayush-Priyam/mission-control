// Codex CLI rollout files (~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl), read-only.
//
// Each line is { timestamp, type, payload }. The types used here:
//   session_meta     payload: id, session_id, cwd, cli_version, originator, git.branch, source (a subagent
//                    has source.subagent.thread_spawn.parent_thread_id), agent_nickname, agent_path
//   turn_context     payload.model: the model of the turns that follow
//   response_item    payload.type: message (role user|assistant|developer, content[].text),
//                    function_call (name, namespace?, arguments JSON, call_id), custom_tool_call (name, input, call_id),
//                    local_shell_call (action.command), web_search_call, *_output (call_id, output)
//   event_msg        payload.type: user_message (message: what the person typed), token_count
//                    (info.last_token_usage / info.total_token_usage), mcp_tool_call_end, patch_apply_end,
//                    exec_command_end
// Older rollouts wrote response items bare (no wrapper); those are read too. Anything else is ignored.

const zero = () => ({ in: 0, out: 0, cacheRead: 0, cacheWrite: 0 })
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0)
const str = (v) => (typeof v === "string" && v ? v : null)
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null)
const ITEM_TYPES = new Set(["message", "function_call", "function_call_output", "custom_tool_call", "custom_tool_call_output", "local_shell_call", "web_search_call", "reasoning"])

/** Parse JSONL leniently: a half-written last line (or any bad line) is skipped, never thrown. */
export function* lines(text) {
  for (const raw of String(text).split("\n")) {
    if (!raw.trim()) continue
    let e
    try { e = JSON.parse(raw) } catch { continue }
    if (e && typeof e === "object" && !Array.isArray(e)) yield e
  }
}

/** One line as { kind, ts, p }: kind is the wrapper type ("response_item", "event_msg", ...), p the payload. */
export function unwrap(e) {
  const ts = str(e.timestamp)
  if (obj(e.payload) && typeof e.type === "string") return { kind: e.type, ts, p: e.payload }
  if (ITEM_TYPES.has(e.type)) return { kind: "response_item", ts, p: e } // older, unwrapped rollouts
  return { kind: null, ts, p: e }
}

/** Text of a message content array or an output: a string, or the text parts joined. */
export function textOf(c) {
  if (typeof c === "string") return c
  if (Array.isArray(c)) return c.map((b) => (typeof b === "string" ? b : typeof b?.text === "string" ? b.text : "")).filter(Boolean).join("\n")
  return ""
}

/** session_meta fields used for identity, place and lanes. */
export function metaOf(p) {
  const spawn = obj(obj(obj(p.source)?.subagent)?.thread_spawn)
  return {
    id: str(p.id),
    sessionId: str(p.session_id) ?? str(p.id),
    cwd: str(p.cwd),
    branch: str(obj(p.git)?.branch),
    version: str(p.cli_version),
    originator: str(p.originator),
    parent: str(spawn?.parent_thread_id) ?? (p.thread_source === "subagent" ? str(p.parent_thread_id) : null),
    nickname: str(p.agent_nickname) ?? str(spawn?.agent_nickname),
    role: str(spawn?.agent_role),
    path: str(p.agent_path) ?? str(spawn?.agent_path),
    startedAt: str(p.timestamp),
  }
}

/** The user's own words in a user_message event (null for empty). */
function userWords(p) {
  const t = typeof p.message === "string" ? p.message.replace(/\s+/g, " ").trim() : ""
  return t || null
}

/**
 * The person's words in a user message item, or null when it is context Codex injects itself
 * (<environment_context>, <user_instructions>, ... and "# AGENTS.md instructions"). Used only when the
 * rollout has no user_message events (exec-mode sessions); tags are stripped for a title.
 */
export function promptOf(p) {
  if (p.type !== "message" || p.role !== "user") return null
  const t = textOf(p.content).trim()
  if (!t || /^<[a-z]+(?:_[a-z]+)+[ >]/i.test(t) || /^<(?:permissions|environment)\b/i.test(t) || /^# AGENTS\.md/i.test(t)) return null
  return t
}
const plain = (t) => t.replace(/<\/?[a-z][\w-]*>/gi, " ").replace(/\s+/g, " ").trim() || null

/** Cheap look at the head of a file: the first session_meta and the first thing the user typed. */
export function peek(text) {
  const out = { meta: null, title: null, model: null, startedAt: null }
  let prompt = null
  for (const e of lines(text)) {
    const { kind, ts, p } = unwrap(e)
    out.startedAt ??= ts
    if (kind === "session_meta" && !out.meta) out.meta = metaOf(p)
    else if (kind === "turn_context") out.model ??= str(p.model)
    else if (kind === "event_msg" && p.type === "user_message") out.title ??= userWords(p)
    else if (kind === "response_item" && !prompt) { const t = promptOf(p); if (t) prompt = plain(t) }
    if (out.meta && out.title && out.model) break
  }
  out.title ??= prompt
  if (out.title) out.title = clip(out.title, 160)
  return out
}

function capInput(input, n) {
  if (!input || typeof input !== "object") return input
  const o = {}
  for (const [k, v] of Object.entries(input)) o[k] = typeof v === "string" ? clip(v, n) : v
  return o
}

const firstLine = (s) => String(s).split("\n").map((l) => l.trim()).find(Boolean) ?? ""

/** One-line description of a call. */
export function summarize(name, input) {
  if (typeof input === "string") {
    if (name === "apply_patch") {
      const files = [...input.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((m) => m[1].trim())
      if (files.length) return clip(files.length > 1 ? `${files[0]} (+${files.length - 1} more)` : files[0], 140)
    }
    return clip(firstLine(input) || name, 140)
  }
  const i = obj(input) ?? {}
  const cmd = Array.isArray(i.command) ? i.command.join(" ") : i.command
  const pick = i.cmd ?? cmd ?? i.path ?? i.file_path ?? i.query ?? i.task_name ?? i.message ?? i.url ?? Object.values(i).find((v) => typeof v === "string")
  return clip(firstLine(pick ?? name) || name, 140)
}

/** Classify a call: an MCP namespace or mcp__srv__tool name -> mcp; spawn_agent -> agent; else tool. */
export function classify(name, namespace) {
  const ns = /^mcp__(.+?)(?:__)?$/.exec(namespace ?? "")
  if (ns) return { kind: "mcp", server: ns[1], name }
  const m = /^mcp__(.+?)__(.+)$/.exec(name)
  if (m) return { kind: "mcp", server: m[1], name: m[2] }
  if (name === "spawn_agent") return { kind: "agent", name }
  return { kind: "tool", name }
}

/** A call from a response item, or null: { id, name, kind, server?, summary, input, ok? }. */
export function callOf(p, ts, fallbackId, cap = 500) {
  let name, input, ns = null
  if (p.type === "function_call") {
    name = str(p.name)
    ns = str(p.namespace)
    try { input = JSON.parse(p.arguments ?? "{}") } catch { input = { arguments: String(p.arguments ?? "") } }
  } else if (p.type === "custom_tool_call") {
    name = str(p.name)
    input = typeof p.input === "string" ? p.input : ""
  } else if (p.type === "local_shell_call") {
    name = "shell"
    input = { command: obj(p.action)?.command ?? [] }
  } else if (p.type === "web_search_call") {
    name = "web_search"
    const a = obj(p.action) ?? {}
    input = { query: a.query ?? (Array.isArray(a.queries) ? a.queries.join(" | ") : "") }
  } else return null
  if (!name) return null
  const c = classify(name, ns)
  const call = { id: str(p.call_id) ?? str(p.id) ?? fallbackId, ts: ts ?? "", name: c.name, kind: c.kind, summary: summarize(name, input) }
  if (c.server) call.server = c.server
  call.input = typeof input === "string" ? { input: clip(input, cap) } : capInput(input, cap)
  if (p.type === "web_search_call" && typeof p.status === "string") call.ok = p.status !== "failed"
  return call
}

/**
 * An output's verdict and body: { error: bool, body, wallMs? }. Exec output carries a header
 * ("Process exited with code N", "Exit code: N", "Wall time: S seconds") or a status line
 * ("Script completed" / "Script failed"); older outputs are JSON with metadata.exit_code.
 */
export function outcome(output) {
  let text = textOf(output)
  let error = false, wallMs
  try {
    const j = JSON.parse(text)
    if (obj(j) && typeof j.output === "string") {
      const code = obj(j.metadata)?.exit_code
      if (typeof code === "number" && code !== 0) error = true
      const d = obj(j.metadata)?.duration_seconds
      if (typeof d === "number") wallMs = Math.round(d * 1000)
      text = j.output
    }
  } catch { /* plain text */ }
  const code = /^Process exited with code (-?\d+)/m.exec(text) ?? /^Exit code: (-?\d+)/m.exec(text)
  if (code && Number(code[1]) !== 0) error = true
  if (/^Script failed/.test(text) || /^apply_patch verification failed/.test(text)) error = true
  const wall = /^Wall time: ([\d.]+) seconds?/m.exec(text)
  if (wall) wallMs = Math.round(Number(wall[1]) * 1000)
  const body = text.includes("\nOutput:\n") ? text.slice(text.indexOf("\nOutput:\n") + 9) : text.replace(/^Script (completed|failed)\s*\n?/, "")
  return { error, body: body.trim(), ...(wallMs !== undefined ? { wallMs } : {}) }
}

const usageTokens = (u) => {
  const input = num(u?.input_tokens), cached = num(u?.cached_input_tokens), write = num(u?.cache_write_input_tokens)
  return { in: Math.max(0, input - cached - write), out: num(u?.output_tokens), cacheRead: cached, cacheWrite: write }
}
const sameUsage = (a, b) => !!a && !!b && ["input_tokens", "cached_input_tokens", "output_tokens", "total_tokens"].every((k) => num(a[k]) === num(b[k]))

/**
 * One rollout file as an accumulator: feed(entry) per parsed line, result() for a snapshot (never mutates).
 * Tokens come from token_count events: each new total adds its last_token_usage (or the delta of the totals),
 * a repeated total (a rate-limit refresh) adds nothing. input_tokens includes cached ones, so `in` is the uncached
 * part. Calls are matched to their outputs by call_id for ok/error, a short result and the duration.
 */
export function rolloutAcc(laneId = "main", costOf = () => 0) {
  const calls = []
  const byCall = new Map()
  const messages = []
  let meta = null, title = null, prompt = null, model = null, firstModel = null, firstTs = null, lastTs = null, errors = 0, prevTotal = null
  function settle(id, ts, { error, body, wallMs }) {
    const hit = byCall.get(id)
    if (error) errors++
    if (!hit) return
    hit.call.ok = !error
    if (error) hit.call.error = clip(body, 200) || "error"
    else if (body) hit.call.result = clip(body, 200)
    const d = wallMs ?? Date.parse(ts ?? "") - Date.parse(hit.at ?? "")
    if (Number.isFinite(d) && d >= 0) hit.call.durationMs = d
  }
  function feed(e) {
    const { kind, ts, p } = unwrap(e)
    if (ts) { firstTs ??= ts; lastTs = ts }
    if (kind === "session_meta") { meta ??= metaOf(p); return }
    if (kind === "turn_context") { model = str(p.model) ?? model; firstModel ??= model; return }
    if (kind === "world_state") { model ??= str(obj(p.state)?.model); return }
    if (kind === "event_msg") {
      if (p.type === "user_message") title ??= userWords(p)
      else if (p.type === "token_count") {
        const info = obj(p.info)
        if (!info) return
        const total = obj(info.total_token_usage), last = obj(info.last_token_usage)
        if (total && sameUsage(total, prevTotal)) return
        let t
        if (last) t = usageTokens(last)
        else if (total) {
          const a = usageTokens(total), b = usageTokens(prevTotal ?? {})
          t = { in: Math.max(0, a.in - b.in), out: Math.max(0, a.out - b.out), cacheRead: Math.max(0, a.cacheRead - b.cacheRead), cacheWrite: Math.max(0, a.cacheWrite - b.cacheWrite) }
        } else return
        if (total) prevTotal = total
        messages.push({ model, ts, tokens: t })
      } else if (p.type === "mcp_tool_call_end" && str(p.call_id)) {
        const r = obj(p.result)
        const err = r ? "Err" in r || obj(r.Ok)?.isError === true : false
        const dur = obj(p.duration)
        const hit = byCall.get(p.call_id)
        if (hit && hit.call.ok === undefined) {
          settle(p.call_id, ts, { error: err, body: err ? textOf(r?.Err ?? obj(r?.Ok)?.content) : textOf(obj(r?.Ok)?.content), ...(dur ? { wallMs: Math.round(num(dur.secs) * 1000 + num(dur.nanos) / 1e6) } : {}) })
          hit.settled = true
        }
      } else if ((p.type === "patch_apply_end" && p.success === false) || (p.type === "exec_command_end" && typeof p.exit_code === "number" && p.exit_code !== 0)) {
        const hit = byCall.get(p.call_id)
        if (hit && hit.call.ok !== false) { if (hit.call.ok === true) errors++; hit.call.ok = false; hit.call.error = clip(String(p.stderr || p.stdout || "error").trim(), 200) || "error"; hit.settled = true }
      }
      return
    }
    if (kind !== "response_item") return
    if (p.type === "message") { if (!prompt) { const t = promptOf(p); if (t) prompt = plain(t) } return }
    if (p.type === "function_call_output" || p.type === "custom_tool_call_output") {
      const id = str(p.call_id)
      const hit = id && byCall.get(id)
      if (hit?.settled) return // an MCP end event already decided it
      settle(id, ts, outcome(p.output))
      return
    }
    const call = callOf(p, ts, `${laneId}:${calls.length}`)
    if (!call) return
    call.lane = laneId
    calls.push(call)
    if (call.ok === false) errors++
    byCall.set(call.id, { call, at: ts })
  }
  function result() {
    const tokens = zero()
    const models = {}
    let cost = 0
    for (const m of messages) {
      tokens.in += m.tokens.in; tokens.out += m.tokens.out; tokens.cacheRead += m.tokens.cacheRead; tokens.cacheWrite += m.tokens.cacheWrite
      cost += costOf(m.model, m.tokens)
      if (m.model) models[m.model] = (models[m.model] ?? 0) + 1
    }
    const snap = calls.map((c) => ({ ...c }))
    const open = [...snap].reverse().find((c) => c.ok === undefined)
    const last = open ?? snap.at(-1)
    const nowDoing = last ? { name: last.name, kind: last.kind, summary: last.summary, ts: last.ts } : undefined
    const m = meta ?? metaOf({})
    return {
      calls: snap, tokens, cost, errors, models, messages: messages.map((x) => ({ ...x })), firstModel: firstModel ?? model, firstTs, lastTs, nowDoing,
      meta: { ...m, title: (title ?? prompt) ? clip(title ?? prompt, 160) : null },
    }
  }
  return { feed, result }
}

const TURN_TEXT = 20_000
const CHIP_TEXT = 4_000

/**
 * A rollout as chat turns, in file order: { i, role, ts, text, tools[] }. User turns are what the person
 * typed (user_message events; a rollout without any, as exec mode writes, uses its user message items
 * minus injected context); assistant turns are assistant messages, and
 * the calls that follow attach to the latest assistant turn as chips with their outcome.
 */
export function turnsAcc() {
  const turns = []
  const byCall = new Map()
  let cur = null // the assistant turn calls attach to
  let events = false // saw a user_message event: user message items are then duplicates
  function feed(e) {
    const { kind, ts, p } = unwrap(e)
    if (kind === "event_msg" && p.type === "user_message") {
      const t = typeof p.message === "string" ? p.message.trim() : ""
      events = true
      if (t) turns.push({ i: turns.length, role: "user", ts, text: clip(t, TURN_TEXT), tools: [] })
      cur = null
      return
    }
    if (kind !== "response_item") return
    if (p.type === "message" && p.role === "user") {
      const t = promptOf(p)
      if (t) { turns.push({ i: turns.length, role: "user", ts, text: clip(t, TURN_TEXT), tools: [], item: true }); cur = null }
      return
    }
    if (p.type === "message" && p.role === "assistant") {
      const text = textOf(p.content).trim()
      if (!text) return
      cur = { i: turns.length, role: "assistant", ts, text: clip(text, TURN_TEXT), tools: [] }
      turns.push(cur)
      return
    }
    if (p.type === "function_call_output" || p.type === "custom_tool_call_output") {
      const hit = byCall.get(p.call_id)
      if (!hit) return
      const o = outcome(p.output)
      hit.chip.ok = !o.error
      if (o.error) hit.chip.error = clip(o.body, CHIP_TEXT) || "error"
      else if (o.body) hit.chip.result = clip(o.body, CHIP_TEXT)
      const d = o.wallMs ?? Date.parse(ts ?? "") - Date.parse(hit.at ?? "")
      if (Number.isFinite(d) && d >= 0) hit.chip.durationMs = d
      return
    }
    const chip = callOf(p, ts, `t${turns.length}:${cur?.tools.length ?? 0}`, CHIP_TEXT)
    if (!chip) return
    if (!cur) { cur = { i: turns.length, role: "assistant", ts, text: "", tools: [] }; turns.push(cur) }
    delete chip.ts
    cur.tools.push(chip)
    byCall.set(chip.id, { chip, at: ts })
  }
  const result = () => turns
    .filter((t) => (t.text || t.tools.length) && !(t.item && events))
    .map(({ item, ...t }, i) => ({ ...t, i, tools: t.tools.map((c) => ({ ...c })) }))
  return { feed, result }
}
