import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { appendFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { createWaitingReader, recordHook, targetOf, waitingFromHooks } from "../src/hooks.mjs"
import { createServer } from "../src/server.mjs"
import create from "../src/sources/claude-code/index.mjs"
import { createRegistry } from "../src/sources/registry.mjs"

const bin = fileURLToPath(new URL("../bin/mission-control.mjs", import.meta.url))
const tmp = () => mkdtempSync(join(tmpdir(), "mc-hooks-"))
const run = (args, input, hooksDir) =>
  spawnSync(process.execPath, [bin, ...args], { input, encoding: "utf8", env: { ...process.env, MISSION_CONTROL_HOOKS_DIR: hooksDir } })
const note = { session_id: "sess1", hook_event_name: "Notification", message: "Claude needs your permission to use Bash" }

test("hook: a Notification on stdin writes one line, no stdout, exit 0", () => {
  const dir = tmp()
  const r = run(["hook", "Notification"], JSON.stringify(note), dir)
  assert.equal(r.status, 0)
  assert.equal(r.stdout, "")
  const lines = readFileSync(join(dir, "sess1.jsonl"), "utf8").trim().split("\n")
  assert.equal(lines.length, 1)
  const l = JSON.parse(lines[0])
  assert.deepEqual([l.event, l.sessionId, l.message], ["Notification", "sess1", "Claude needs your permission to use Bash"])
  assert.ok(!Number.isNaN(Date.parse(l.ts)))
})

test("hook: tool name and a short target are recorded for PreToolUse, never the rest of tool_input", () => {
  const dir = tmp()
  run(["hook", "PreToolUse"], JSON.stringify({ session_id: "s", hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls", description: "secret" } }), dir)
  const l = JSON.parse(readFileSync(join(dir, "s.jsonl"), "utf8"))
  assert.deepEqual([l.tool, l.target], ["Bash", "ls"])
  assert.ok(!JSON.stringify(l).includes("secret"))
})

test("hook: malformed stdin, empty stdin, unsafe session id or unknown event exit 0 and write nothing", () => {
  const dir = tmp()
  for (const input of ["{not json", "", "[]", JSON.stringify({ session_id: "../evil", hook_event_name: "Stop" }), JSON.stringify({ session_id: "ok", hook_event_name: "Bogus" }), JSON.stringify({ hook_event_name: "Stop" })]) {
    const r = run(["hook", "Stop"], input, dir)
    assert.equal(r.status, 0)
    assert.equal(r.stdout, "")
  }
  assert.deepEqual(existsSync(dir) ? readdirSync(dir) : [], [])
})

test("waitingFromHooks: Notification then PreToolUse is not waiting; Notification last is", () => {
  const n = { event: "Notification", ts: "2026-11-02T10:00:00.000Z", message: "needs you" }
  assert.deepEqual(waitingFromHooks([n, { event: "PreToolUse", ts: "2026-11-02T10:00:05.000Z" }]), { waiting: false })
  assert.deepEqual(waitingFromHooks([n]), { waiting: true, message: "needs you", since: n.ts })
  assert.deepEqual(waitingFromHooks([n, { event: "UserPromptSubmit" }]), { waiting: false })
  assert.deepEqual(waitingFromHooks([n, { event: "Stop" }]), { waiting: false })
  assert.equal(waitingFromHooks([n, { event: "SubagentStop" }]).waiting, true)
  assert.equal(waitingFromHooks([{ event: "PreToolUse" }, n]).waiting, true)
  assert.deepEqual(waitingFromHooks([]), { waiting: false })
  assert.equal(waitingFromHooks(`${JSON.stringify(n)}\n{"half`).waiting, true)
})

test("hooks install: valid JSON with every listened event (PermissionRequest included) and absolute node + script", () => {
  const r = run(["hooks", "install"], "", tmp())
  assert.equal(r.status, 0)
  const { hooks } = JSON.parse(r.stdout)
  assert.deepEqual(Object.keys(hooks), ["Notification", "PermissionRequest", "Stop", "SubagentStop", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionDenied"])
  for (const [e, v] of Object.entries(hooks)) {
    const h = v[0].hooks[0]
    assert.equal(h.type, "command")
    assert.ok(h.command.includes(process.execPath) && h.command.includes(bin) && h.command.endsWith(`hook ${e}`), h.command)
  }
})

function fixture(hookLines, { logMtime }) {
  const root = tmp(), hooksDir = tmp()
  mkdirSync(join(root, "-work-shop"), { recursive: true })
  const log = join(root, "-work-shop", "sess1.jsonl")
  writeFileSync(log, JSON.stringify({ type: "user", cwd: "/work/shop", sessionId: "sess1", timestamp: "2026-11-02T09:59:00.000Z", message: { role: "user", content: "hello" } }) + "\n")
  utimesSync(log, logMtime / 1000, logMtime / 1000)
  if (hookLines) writeFileSync(join(hooksDir, "sess1.jsonl"), hookLines.map((l) => JSON.stringify(l)).join("\n") + "\n")
  return { root, hooksDir, log }
}
const T = Date.parse("2026-11-02T10:00:00.000Z")
const notified = [{ event: "Notification", sessionId: "sess1", ts: new Date(T).toISOString(), message: "Claude needs your permission to use Bash" }]

test("source: unanswered Notification makes the session waiting with the message as needs-you detail", async () => {
  const { root, hooksDir } = fixture(notified, { logMtime: T - 5000 })
  const src = create({ root, hooksDir, now: () => T + 10_000 })
  const [item] = await src.listItems()
  assert.deepEqual([item.status, item.waiting], ["waiting", true])
  const got = await src.getItem("sess1")
  assert.deepEqual([got.summary.status, got.summary.waiting, got.lanes[0].status], ["waiting", true, "waiting"])
  const ov = await createRegistry([src]).overview()
  assert.equal(ov.counts.waiting, 1)
  assert.deepEqual(ov.needsYou.map((n) => [n.id, n.lane, n.detail]), [["sess1", "main", "Claude needs your permission to use Bash"]])
})

test("source: a later PreToolUse hook clears waiting", async () => {
  const { root, hooksDir } = fixture([...notified, { event: "PreToolUse", sessionId: "sess1", ts: new Date(T + 1000).toISOString(), tool: "Bash" }], { logMtime: T - 5000 })
  const src = create({ root, hooksDir, now: () => T + 10_000 })
  assert.equal((await src.listItems())[0].waiting, false)
  assert.equal((await src.getItem("sess1")).summary.status, "working")
})

test("source: session log activity after the Notification clears waiting without another hook", async () => {
  const { root, hooksDir, log } = fixture(notified, { logMtime: T - 5000 })
  const src = create({ root, hooksDir, now: () => T + 60_000 })
  assert.equal((await src.listItems())[0].waiting, true)
  appendFileSync(log, JSON.stringify({ type: "assistant", timestamp: new Date(T + 20_000).toISOString(), message: { role: "assistant", content: [{ type: "text", text: "continuing" }] } }) + "\n")
  utimesSync(log, (T + 20_000) / 1000, (T + 20_000) / 1000)
  const [item] = await src.listItems()
  assert.deepEqual([item.waiting, item.status], [false, "working"])
  assert.equal((await src.getItem("sess1")).summary.waiting, false)
})

test("source: no hook log or no hooksDir leaves status unchanged", async () => {
  const { root } = fixture(null, { logMtime: T - 5000 })
  assert.equal((await create({ root, hooksDir: tmp(), now: () => T }).listItems())[0].waiting, false)
  assert.equal((await create({ root, now: () => T }).listItems())[0].waiting, false)
})

const turn = (type, ms) => JSON.stringify({ type, timestamp: new Date(ms).toISOString(), message: { role: type, content: [{ type: "text", text: "x" }] } }) + "\n"
const withNote = (message, ts = T) => [{ event: "Notification", sessionId: "sess1", ts: new Date(ts).toISOString(), message }]

test("source: idle reminder is ready, not waiting: status idle, reason, not in needs-you", async () => {
  const { root, hooksDir } = fixture(withNote("Claude is waiting for your input"), { logMtime: T - 5000 })
  const src = create({ root, hooksDir, now: () => T + 10_000 })
  const [item] = await src.listItems()
  assert.deepEqual([item.status, item.waiting, item.live], ["idle", false, false]) // minor 4: ready is not LIVE
  const got = await src.getItem("sess1")
  assert.deepEqual([got.summary.status, got.summary.waiting, got.summary.live, got.lanes[0].status, got.lanes[0].reason], ["idle", false, false, "idle", "ready for input"])
  const ov = await createRegistry([src]).overview()
  assert.deepEqual([ov.counts.waiting, ov.needsYou.length], [0, 0])
})

test("source: permission Notification is waiting; the same one 13 h old with no activity is not", async () => {
  const msg = "Claude needs your permission to use Bash"
  const { root, hooksDir } = fixture(withNote(msg), { logMtime: T - 5000 })
  assert.equal((await create({ root, hooksDir, now: () => T + 11 * 3600_000 }).listItems())[0].waiting, true)
  const old = await create({ root, hooksDir, now: () => T + 13 * 3600_000 }).listItems()
  assert.deepEqual([old[0].waiting, old[0].status], [false, "idle"])
})

test("source: a subagent log write after the Notification does not clear waiting", async () => {
  const { root, hooksDir } = fixture(notified, { logMtime: T - 5000 })
  const sub = join(root, "-work-shop", "sess1", "subagents")
  mkdirSync(sub, { recursive: true })
  writeFileSync(join(sub, "agent-a1.jsonl"), turn("assistant", T + 30_000))
  utimesSync(join(sub, "agent-a1.jsonl"), (T + 30_000) / 1000, (T + 30_000) / 1000)
  const src = create({ root, hooksDir, now: () => T + 40_000 })
  assert.equal((await src.listItems())[0].waiting, true)
  assert.equal((await src.getItem("sess1")).summary.waiting, true)
})

test("source: summary and system lines in the main log do not clear; an assistant record 3 s later does; 1 s later does not", async () => {
  const { root, hooksDir, log } = fixture(notified, { logMtime: T - 5000 })
  const src = create({ root, hooksDir, now: () => T + 60_000 })
  const add = (line, ms) => { appendFileSync(log, line); utimesSync(log, ms / 1000, ms / 1000) }
  add(JSON.stringify({ type: "summary", summary: "s", timestamp: new Date(T + 10_000).toISOString() }) + "\n" + turn("system", T + 11_000), T + 12_000)
  assert.equal((await src.listItems())[0].waiting, true)
  add(turn("assistant", T + 1000), T + 13_000)
  assert.equal((await src.listItems())[0].waiting, true)
  add(turn("assistant", T + 3000), T + 14_000)
  assert.equal((await src.listItems())[0].waiting, false)
})

test("hook: dir is created 0700 and the log 0600", () => {
  const dir = join(tmp(), "hooks")
  run(["hook", "Stop"], JSON.stringify({ session_id: "p", hook_event_name: "Stop" }), dir)
  assert.equal(statSync(dir).mode & 0o777, 0o700)
  assert.equal(statSync(join(dir, "p.jsonl")).mode & 0o777, 0o600)
})

test("I3: hook logs are cached by size+mtime and read from the tail when large", () => {
  const dir = mkdtempSync(join(tmpdir(), "mc-hooks-tail-"))
  const reads = []
  const read = createWaitingReader({ tailBytes: 1024, onRead: (p, r) => reads.push(r.bytes) })
  const line = (o) => JSON.stringify({ sessionId: "s", ts: "2026-11-02T09:00:00.000Z", ...o }) + "\n"
  const file = join(dir, "s.jsonl")
  // ~20 KB of old history, then an open Notification.
  writeFileSync(file, line({ event: "Stop" }).repeat(300) + line({ event: "Notification", message: "Needs approval" }))
  const size = statSync(file).size
  assert.ok(size > 10_000)
  assert.deepEqual(read(dir, "s"), { waiting: true, message: "Needs approval", since: "2026-11-02T09:00:00.000Z" })
  assert.deepEqual(reads, [1024]) // tail only
  read(dir, "s"); read(dir, "s")
  assert.deepEqual(reads, [1024], "unchanged log is not read again")
  appendFileSync(file, line({ event: "PreToolUse", tool: "Bash" }))
  assert.equal(read(dir, "s").waiting, false)
  assert.equal(reads.length, 2)
  // A tail with no deciding event (only SubagentStop) falls back to the whole log.
  writeFileSync(file, line({ event: "Notification", message: "Old ask" }) + line({ event: "SubagentStop" }).repeat(300))
  assert.equal(read(dir, "s").waiting, true)
  assert.deepEqual(reads.slice(2), [1024, statSync(file).size])
  assert.deepEqual(read(dir, "missing"), { waiting: false })
})

// ---- v2.1 item 1: stale prompt safety and prompt identity ----

test("hook line: PreToolUse and PermissionRequest keep tool + the first 120 chars of the command or path, nothing else of tool_input", () => {
  const dir = tmp()
  const long = `npm test -- --grep ${"x".repeat(200)}`
  assert.ok(recordHook({ hooksDir: dir, raw: JSON.stringify({ session_id: "s", hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: long, description: "SECRET-DESC" } }) }))
  assert.ok(recordHook({ hooksDir: dir, raw: JSON.stringify({ session_id: "s", hook_event_name: "PermissionRequest", tool_name: "Write", tool_input: { file_path: "/work/shop/.env", content: "TOKEN=SECRET-CONTENT" } }) }))
  const [pre, perm] = readFileSync(join(dir, "s.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
  assert.deepEqual([pre.tool, pre.target], ["Bash", long.slice(0, 120)])
  assert.deepEqual([perm.event, perm.tool, perm.target, perm.message], ["PermissionRequest", "Write", "/work/shop/.env", "Claude needs your permission to use Write"])
  const text = readFileSync(join(dir, "s.jsonl"), "utf8")
  assert.ok(!text.includes("SECRET"), "no description, content or other tool_input fields")
  assert.equal(targetOf({ command: "a\n  b" }), "a b")
  assert.equal(targetOf({ content: "x" }), null)
})

test("waitingFromHooks: PermissionRequest opens at once; the ~6 s Notification after it is the same prompt; PostToolUse clears", () => {
  const pre = { event: "PreToolUse", ts: "2026-11-02T10:00:00.000Z", tool: "Bash", target: "npm test" }
  const perm = { event: "PermissionRequest", ts: "2026-11-02T10:00:01.000Z", tool: "Bash", target: "npm test", message: "Claude needs your permission to use Bash" }
  const note6 = { event: "Notification", ts: "2026-11-02T10:00:07.000Z", kind: "permission_prompt", message: "Claude needs your permission to use Bash" }
  assert.deepEqual(waitingFromHooks([pre, perm]), { waiting: true, message: perm.message, since: perm.ts, tool: "Bash", target: "npm test" })
  assert.equal(waitingFromHooks([pre, perm, note6]).since, perm.ts, "the reminder does not make it a new prompt")
  assert.deepEqual(waitingFromHooks([pre, perm, { event: "PostToolUse", ts: "2026-11-02T10:00:09.000Z", tool: "Bash" }]), { waiting: false })
  assert.deepEqual(waitingFromHooks([pre, perm, { event: "PermissionDenied" }]), { waiting: false })
  // An older Claude Code without PermissionRequest: the Notification takes tool and target from the PreToolUse before it.
  assert.deepEqual(waitingFromHooks([pre, note6]), { waiting: true, message: note6.message, since: note6.ts, tool: "Bash", target: "npm test" })
  // A second prompt after the first was answered is new: its own since, tool and target.
  const pre2 = { event: "PreToolUse", ts: "2026-11-02T10:01:00.000Z", tool: "Edit", target: "/work/shop/a.ts" }
  const perm2 = { event: "PermissionRequest", ts: "2026-11-02T10:01:01.000Z", tool: "Edit", target: "/work/shop/a.ts" }
  const w = waitingFromHooks([pre, perm, { event: "PostToolUse" }, pre2, perm2])
  assert.deepEqual([w.since, w.tool, w.target], [perm2.ts, "Edit", "/work/shop/a.ts"])
  // idle_prompt by type is ready, not waiting
  assert.deepEqual(waitingFromHooks([{ event: "Notification", kind: "idle_prompt", ts: "2026-11-02T10:05:00.000Z", message: "Claude is idle" }]), { waiting: false, ready: true, message: "Claude is idle", since: "2026-11-02T10:05:00.000Z" })
})

async function overviewFrom(root, hooksDir, now) {
  const dist = tmp()
  writeFileSync(join(dist, "index.html"), "<!doctype html>")
  const srv = await createServer([create({ root, hooksDir, now: () => now })], { port: 0, distDir: dist, git: stubGit, now: () => now })
  try {
    const r = await fetch(`http://127.0.0.1:${srv.port}/api/overview`, { headers: { host: `127.0.0.1:${srv.port}` } })
    return await r.json()
  } finally { await srv.close() }
}
const stubGit = { resolve: async (cwd) => ({ commonDir: `${cwd}/.git`, toplevel: cwd }), worktrees: async (c) => [{ path: c.replace(/\/\.git$/, ""), branch: "main" }], status: async () => null }

test("stale prompt: permission prompt -> dashboard down -> answered in the terminal -> dashboard starts: not in Needs you", async () => {
  const { root, hooksDir, log } = fixture(null, { logMtime: T - 5000 })
  const hook = (o) => appendFileSync(join(hooksDir, "sess1.jsonl"), JSON.stringify({ sessionId: "sess1", ...o }) + "\n")
  // Claude asks to run a command: tool_use in the log, then PreToolUse and PermissionRequest hooks.
  appendFileSync(log, JSON.stringify({ type: "assistant", timestamp: new Date(T).toISOString(), message: { id: "m1", role: "assistant", content: [{ type: "tool_use", id: "tu1", name: "Bash", input: { command: "rm -rf build" } }] } }) + "\n")
  hook({ event: "PreToolUse", ts: new Date(T).toISOString(), tool: "Bash", target: "rm -rf build" })
  hook({ event: "PermissionRequest", ts: new Date(T + 500).toISOString(), tool: "Bash", target: "rm -rf build", message: "Claude needs your permission to use Bash" })
  utimesSync(log, T / 1000, T / 1000)
  const up = await overviewFrom(root, hooksDir, T + 5000)
  assert.deepEqual(up.needsYou.map((n) => [n.id, n.tool, n.target, n.since]), [["sess1", "Bash", "rm -rf build", new Date(T + 500).toISOString()]])
  // Dashboard is down (no server). The person answers in the terminal: the tool runs, Claude carries on.
  appendFileSync(log, JSON.stringify({ type: "user", timestamp: new Date(T + 30_000).toISOString(), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", content: "ok" }] } }) + "\n")
  hook({ event: "PostToolUse", ts: new Date(T + 30_000).toISOString(), tool: "Bash" })
  appendFileSync(log, JSON.stringify({ type: "assistant", timestamp: new Date(T + 32_000).toISOString(), message: { id: "m2", role: "assistant", content: [{ type: "text", text: "cleaned" }] } }) + "\n")
  utimesSync(log, (T + 32_000) / 1000, (T + 32_000) / 1000)
  // A fresh dashboard (empty caches) starts after all of that.
  const after = await overviewFrom(root, hooksDir, T + 40_000)
  assert.deepEqual([after.needsYou.length, after.counts.waiting], [0, 0])
})

test("stale prompt: answered while the dashboard was down and the hooks predate PostToolUse: the log lines alone clear it", async () => {
  const { root, hooksDir, log } = fixture(notified, { logMtime: T - 5000 })
  assert.equal((await overviewFrom(root, hooksDir, T + 5000)).needsYou.length, 1)
  appendFileSync(log, JSON.stringify({ type: "user", timestamp: new Date(T + 20_000).toISOString(), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "ok" }] } }) + "\n")
  utimesSync(log, (T + 20_000) / 1000, (T + 20_000) / 1000)
  assert.equal((await overviewFrom(root, hooksDir, T + 40_000)).needsYou.length, 0)
})

test("ready: Claude's idle reminder makes the session ready (counted and listed in the overview, not in Needs you)", async () => {
  const { root, hooksDir } = fixture([{ event: "Notification", sessionId: "sess1", ts: new Date(T).toISOString(), kind: "idle_prompt", message: "Claude is waiting for your input" }], { logMtime: T - 5000 })
  const src = create({ root, hooksDir, now: () => T + 10_000 })
  const [item] = await src.listItems()
  assert.deepEqual([item.ready, item.readySince, item.status], [true, new Date(T).toISOString(), "idle"])
  assert.equal((await src.getItem("sess1")).summary.ready, true)
  const ov = await createRegistry([src]).overview()
  assert.deepEqual([ov.counts.ready, ov.counts.waiting, ov.needsYou.length], [1, 0, 0])
  assert.deepEqual(ov.ready.map((r) => [r.id, r.since]), [["sess1", new Date(T).toISOString()]])
  const { shapeTree, buildTree } = await import("../src/projects.mjs")
  const tree = shapeTree(await buildTree(await src.listItems(), { git: stubGit }), { now: T })
  assert.equal(tree[0].worktrees[0].counts.ready, 1)
})
