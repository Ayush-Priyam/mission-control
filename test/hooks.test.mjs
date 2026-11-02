import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { appendFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { waitingFromHooks } from "../src/hooks.mjs"
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

test("hook: tool name is recorded for PreToolUse", () => {
  const dir = tmp()
  run(["hook", "PreToolUse"], JSON.stringify({ session_id: "s", hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "secret" } }), dir)
  const l = JSON.parse(readFileSync(join(dir, "s.jsonl"), "utf8"))
  assert.equal(l.tool, "Bash")
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

test("hooks install: valid JSON with the five events and absolute node + script", () => {
  const r = run(["hooks", "install"], "", tmp())
  assert.equal(r.status, 0)
  const { hooks } = JSON.parse(r.stdout)
  assert.deepEqual(Object.keys(hooks), ["Notification", "Stop", "SubagentStop", "UserPromptSubmit", "PreToolUse"])
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
