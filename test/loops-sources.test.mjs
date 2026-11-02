import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import createClaude from "../src/sources/claude-code/index.mjs"
import createCodex from "../src/sources/codex/index.mjs"
import { fromAdapter } from "../src/sources/from-adapter.mjs"
import { createRegistry } from "../src/sources/registry.mjs"

const T = Date.parse("2026-11-02T10:00:00.000Z")
const iso = (ms) => new Date(ms).toISOString()
const tmp = () => mkdtempSync(join(tmpdir(), "mc-loops-src-"))

function claudeSession(fails, { pass = false } = {}) {
  const root = tmp()
  mkdirSync(join(root, "-work-shop"), { recursive: true })
  const file = join(root, "-work-shop", "s1.jsonl")
  const lines = [{ type: "user", cwd: "/work/shop", sessionId: "s1", timestamp: iso(T), message: { role: "user", content: "make tests pass" } }]
  for (let i = 0; i < fails; i++) {
    const at = T + (i + 1) * 60_000
    lines.push({ type: "assistant", timestamp: iso(at), message: { id: `m${i}`, model: "claude-sonnet-4-5", usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 0 }, content: [{ type: "tool_use", id: `tu${i}`, name: "Bash", input: { command: "npm test" } }] } })
    const ok = pass && i === fails - 1
    lines.push({ type: "user", timestamp: iso(at + 5000), message: { role: "user", content: [{ type: "tool_result", tool_use_id: `tu${i}`, is_error: !ok, content: ok ? "all passed" : "FAIL cart.test.ts" }] } })
  }
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n")
  const end = T + (fails + 1) * 60_000
  utimesSync(file, end / 1000, end / 1000)
  return { root, now: end + 10_000 }
}

test("claude-code: a live session failing npm test 4× is looping (item, lane, overview count + list); a fix in the end is not", async () => {
  const { root, now } = claudeSession(4)
  const src = createClaude({ root, now: () => now })
  const got = await src.getItem("s1")
  assert.equal(got.summary.status, "looping")
  assert.deepEqual([got.lanes[0].status, got.lanes[0].loop.failures, got.lanes[0].loop.firstCallId, got.lanes[0].loop.reason], ["looping", 4, "tu0", "npm test failed 4×"])
  assert.ok(got.lanes[0].loop.costSince > 0)
  assert.deepEqual([got.summary.sinceChange.tokens, got.summary.sinceChange.cached], [4 * 1_100, 4 * 10_000], "cache reads apart")
  const ov = await createRegistry([src]).overview()
  assert.deepEqual([ov.counts.looping, ov.counts.working], [1, 0])
  assert.deepEqual(ov.looping.map((l) => [l.id, l.lane, l.loop.failures]), [["s1", "main", 4]])
  assert.equal((await src.listItems())[0].status, "looping", "the listing knows once the session was opened")
  const fixed = claudeSession(5, { pass: true })
  assert.equal((await createClaude({ root: fixed.root, now: () => fixed.now }).getItem("s1")).summary.status, "working")
})

test("claude-code: thresholds are injectable (repeat 6: four failures are not looping)", async () => {
  const { root, now } = claudeSession(4)
  assert.equal((await createClaude({ root, now: () => now, loops: () => ({ repeat: 6 }) }).getItem("s1")).summary.status, "working")
})

test("codex: exec_command failing the same way 4× in a live rollout is looping", async () => {
  const root = tmp()
  const id = "44444444-4444-4444-8444-444444444444"
  const dir = join(root, "2026", "11", "02")
  mkdirSync(dir, { recursive: true })
  const L = [
    { timestamp: iso(T), type: "session_meta", payload: { id, session_id: id, timestamp: iso(T), cwd: "/work/shop", cli_version: "0.50.0" } },
    { timestamp: iso(T), type: "turn_context", payload: { turn_id: "t1", cwd: "/work/shop", model: "gpt-5" } },
  ]
  for (let i = 0; i < 4; i++) {
    const at = T + (i + 1) * 60_000
    L.push({ timestamp: iso(at), type: "response_item", payload: { type: "function_call", name: "exec_command", arguments: JSON.stringify({ cmd: "cargo test" }), call_id: `c${i}` } })
    L.push({ timestamp: iso(at + 2000), type: "response_item", payload: { type: "function_call_output", call_id: `c${i}`, output: "Process exited with code 101\nOutput:\nerror: test failed" } })
  }
  const file = join(dir, `rollout-2026-11-02T10-00-00-${id}.jsonl`)
  writeFileSync(file, L.map((l) => JSON.stringify(l)).join("\n") + "\n")
  const end = T + 5 * 60_000
  utimesSync(file, end / 1000, end / 1000)
  const got = await createCodex({ root, now: () => end + 5000 }).getItem(id)
  assert.equal(got.summary.status, "looping")
  assert.equal(got.lanes[0].loop.failures, 4)
  assert.equal(got.lanes[0].loop.firstCallId, "c0")
})

test("v1 adapter run: a live stage whose progress keeps raising the same issue is looping", async () => {
  const events = []
  for (let i = 0; i < 4; i++) events.push({ ts: iso(T + i * 60_000), type: "progress", stage: "backend", tool: "Bash", detail: "npm test" }, { ts: iso(T + i * 60_000 + 1000), type: "issue", stage: "backend", summary: "tests red" })
  const adapter = { name: "native", listRuns: async () => [{ id: "r1" }], getRun: async () => ({ live: true, state: { stages: { backend: { status: "running" } } }, events }), getSession: async () => null }
  const src = fromAdapter(adapter, { now: () => T + 5 * 60_000 })
  const got = await src.getItem("r1")
  assert.equal(got.summary.status, "looping")
  assert.deepEqual([got.lanes[0].status, got.lanes[0].loop.failures], ["looping", 4])
  const done = fromAdapter({ ...adapter, getRun: async () => ({ live: false, state: { stages: { backend: { status: "failed" } } }, events }) }, { now: () => T })
  assert.equal((await done.getItem("r1")).summary.status, "failed", "a run that is not live is not looping")
})
