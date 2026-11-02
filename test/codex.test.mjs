import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import create, { idOfName } from "../src/sources/codex/index.mjs"
import { outcome, rolloutAcc, lines } from "../src/sources/codex/parse.mjs"
import { costOf, openaiPrice } from "../src/sources/claude-code/prices.mjs"
import { CODEX_EVENTS, codexHooksBlock, recordCodexHook } from "../src/hooks.mjs"
import { loadCodex, parseArgs } from "../src/adapters/load.mjs"
import { createRegistry } from "../src/sources/registry.mjs"

const root = fileURLToPath(new URL("./fixtures/codex/sessions", import.meta.url))
const C1 = "11111111-1111-4111-8111-111111111111"
const SUB = "22222222-2222-4222-8222-222222222222"
const C2 = "33333333-3333-4333-8333-333333333333"
const f1 = join(root, "2026/11/01", `rollout-2026-11-01T09-00-00-${C1}.jsonl`)
const fs = join(root, "2026/11/01", `rollout-2026-11-01T09-00-27-${SUB}.jsonl`)
// git does not keep mtimes: "now" is taken relative to the files as checked out.
const lastMs = Math.max(statSync(f1).mtimeMs, statSync(fs).mtimeMs)
const src = (now, extra = {}) => create({ root, now: () => now ?? lastMs + 3_600_000, ...extra })
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`)

test("ids come from the rollout file name", () => {
  assert.equal(idOfName(`rollout-2026-11-01T09-00-00-${C1}.jsonl`), C1)
  assert.equal(idOfName("rollout-odd.jsonl"), "odd")
})

test("list: root sessions only, with cwd, branch, title and lane count from the head", async () => {
  const items = await src().listItems()
  assert.deepEqual(items.map((i) => i.id).sort(), [C1, C2]) // the subagent rollout is a lane, not an item
  const s1 = items.find((i) => i.id === C1)
  assert.deepEqual([s1.source, s1.kind, s1.harness, s1.cwd, s1.branch, s1.title, s1.counts.lanes], ["codex", "session", "codex", "/work/shop", "feat/cart", "Add a cart page", 2])
  assert.equal(s1.startedAt, "2026-11-01T09:00:00.000Z")
  assert.equal(s1.partial, true)
  const s2 = items.find((i) => i.id === C2)
  // exec mode writes no user_message event: the title is the first user message that is not injected context
  assert.deepEqual([s2.branch, s2.title, s2.counts.lanes], ["main", "fix the checkout bug", 1])
})

test("item: main lane plus a subagent lane labelled from its session_meta", async () => {
  const { summary, lanes } = await src().getItem(C1)
  assert.deepEqual(lanes.map((l) => [l.id, l.kind, l.label, l.parent ?? null]), [["main", "main", "main", null], [`agent-${SUB}`, "subagent", "Cart reviewer", "main"]])
  assert.deepEqual([lanes[0].model, lanes[1].model, lanes[1].agentType], ["gpt-5", "gpt-5-mini", "reviewer"])
  assert.deepEqual(summary.counts, { lanes: 2, calls: 7, errors: 1 })
  assert.deepEqual([lanes[0].calls, lanes[0].errors, lanes[1].calls], [6, 1, 1])
  assert.equal(summary.version, "0.50.0")
  assert.equal(await src().getItem(SUB), null) // a subagent is reached through its root
  assert.equal(await src().getItem("nope"), null)
})

test("calls: exec, apply_patch, mcp with server, agent, error, durations; truncated last line skipped", async () => {
  const calls = await src().getCalls(C1)
  const by = Object.fromEntries(calls.map((c) => [c.id, c]))
  assert.equal(calls.length, 7)
  assert.deepEqual([by.call_rg.kind, by.call_rg.name, by.call_rg.summary, by.call_rg.ok, by.call_rg.durationMs, by.call_rg.result], ["tool", "exec_command", "rg -n cart src", true, 1500, "src/routes.ts:4: cart"])
  assert.deepEqual([by.call_ctx.kind, by.call_ctx.server, by.call_ctx.name, by.call_ctx.ok, by.call_ctx.durationMs], ["mcp", "ctx", "query-docs", true, 4000])
  assert.deepEqual([by.call_patch.kind, by.call_patch.name, by.call_patch.summary, by.call_patch.ok, by.call_patch.durationMs], ["tool", "apply_patch", "src/cart.ts", true, 200])
  assert.deepEqual([by.call_test.ok, by.call_test.error, by.call_test.durationMs, by.call_test.summary], [false, "1 failing", 6000, "npm test"])
  assert.deepEqual([by.call_spawn.kind, by.call_spawn.summary], ["agent", "review the cart page"])
  assert.deepEqual([by.call_sub_read.lane, by.call_sub_read.name, by.call_sub_read.ok, by.call_sub_read.durationMs], [`agent-${SUB}`, "exec", true, 5000])
  assert.equal(by.call_read.ok, undefined) // its output line is cut off
  assert.deepEqual(calls.map((c) => c.ts), [...calls.map((c) => c.ts)].sort())
  const c2 = await src().getCalls(C2)
  assert.deepEqual(c2.map((c) => [c.id, c.ok, c.error ?? null]), [["call_grep", false, "rg: src: No such file or directory"], ["call_grep2", undefined, null]])
})

test("calls: lane, kind and q filters", async () => {
  const s = src()
  assert.deepEqual((await s.getCalls(C1, { lane: `agent-${SUB}` })).map((c) => c.id), ["call_sub_read"])
  assert.deepEqual((await s.getCalls(C1, { kind: "mcp" })).map((c) => c.id), ["call_ctx"])
  assert.deepEqual((await s.getCalls(C1, { kind: "agent" })).map((c) => c.id), ["call_spawn"])
  assert.deepEqual((await s.getCalls(C1, { q: "NPM" })).map((c) => c.id), ["call_test"])
  assert.deepEqual(await s.getCalls("nope"), [])
})

test("tokens: each new total adds its last usage, a repeated total adds nothing; cost from OpenAI list prices", async () => {
  const { summary, lanes } = await src().getItem(C1)
  assert.deepEqual(lanes[0].tokens, { in: 1000, out: 500, cacheRead: 2000, cacheWrite: 0 }) // input minus cached
  assert.deepEqual(lanes[1].tokens, { in: 400, out: 50, cacheRead: 100, cacheWrite: 0 }) // no last usage: the delta of totals
  near(lanes[0].cost, (1000 * 1.25 + 500 * 10 + 2000 * 0.125) / 1e6)
  near(lanes[1].cost, (400 * 0.25 + 50 * 2 + 100 * 0.025) / 1e6)
  near(summary.cost, lanes[0].cost + lanes[1].cost)
  const s2 = await src().getItem(C2)
  assert.deepEqual([s2.summary.tokens.in, s2.summary.cost], [100, 0]) // unknown model: unpriced, no crash
  const s = src()
  await s.getItem(C1)
  const listed = (await s.listItems()).find((i) => i.id === C1)
  assert.deepEqual([listed.counts.calls, listed.counts.errors, listed.tokens.in, listed.partial], [7, 1, 1400, undefined])
})

test("prices: OpenAI ids priced exactly, dated suffix dropped, unknown and newer versions free", () => {
  assert.deepEqual(openaiPrice("gpt-5-2025-08-07"), openaiPrice("gpt-5"))
  assert.equal(openaiPrice("gpt-5.9"), null)
  assert.equal(openaiPrice("gpt-mystery"), null)
  assert.equal(costOf("gpt-mystery", { in: 9, out: 9, cacheRead: 9, cacheWrite: 9 }), 0)
  assert.equal(costOf("gpt-5", { in: 1e6, out: 0, cacheRead: 0, cacheWrite: 0 }), 1.25)
  assert.equal(costOf("claude-sonnet-4-5", { in: 1e6, out: 0, cacheRead: 0, cacheWrite: 0 }), 3) // Claude unchanged
})

test("outcome: exit code headers, script status, legacy JSON metadata", () => {
  assert.deepEqual(outcome("Chunk ID: a\nWall time: 2 seconds\nProcess exited with code 2\nOutput:\nboom"), { error: true, body: "boom", wallMs: 2000 })
  assert.equal(outcome("Exit code: 0\nok").error, false)
  assert.equal(outcome([{ type: "input_text", text: "Script failed" }, { type: "input_text", text: "x" }]).error, true)
  assert.deepEqual(outcome('{"output":"bad","metadata":{"exit_code":1,"duration_seconds":0.5}}'), { error: true, body: "bad", wallMs: 500 })
  assert.equal(outcome("apply_patch verification failed: no such file").error, true)
})

test("turns: typed user messages, assistant text, tool chips; injected context skipped", async () => {
  const s = src()
  const t = await s.getTurns(C1, "main")
  assert.deepEqual(t.turns.map((x) => [x.role, x.text, x.tools.length]), [["user", "Add a cart page", 0], ["assistant", "Looking at the routes first.", 6]])
  const chip = t.turns[1].tools.find((c) => c.id === "call_test")
  assert.deepEqual([chip.ok, chip.error], [false, "1 failing"])
  const sub = await s.getTurns(C1, `agent-${SUB}`)
  assert.deepEqual(sub.turns.map((x) => [x.role, x.text, x.tools.length]), [["assistant", "", 1], ["assistant", "looks fine", 0]])
  const exec = await s.getTurns(C2, "main")
  assert.deepEqual(exec.turns.map((x) => x.role), ["user", "assistant"])
  assert.match(exec.turns[0].text, /fix the checkout bug/)
  const page = await s.getTurns(C1, "main", { limit: 1 })
  assert.deepEqual([page.total, page.start, page.turns.length], [2, 1, 1])
  assert.equal(await s.getTurns(C1, "agent-nope"), null)
})

test("live: modified within two minutes of now", async () => {
  const live = (await src(lastMs + 60_000).listItems()).find((i) => i.id === C1)
  assert.deepEqual([live.live, live.status], [true, "working"])
  const idle = (await src(lastMs + 3 * 60_000).listItems()).find((i) => i.id === C1)
  assert.deepEqual([idle.live, idle.status, idle.waiting], [false, "idle", false])
})

test("waiting: a Codex PermissionRequest hook opens a wait; a later tool event clears it", async () => {
  const hooksDir = mkdtempSync(join(tmpdir(), "mc-hooks-"))
  // After both the checkout mtimes and the rollout's own timestamps: a wait expires after 12 h, and a
  // rollout record newer than the hook means the session moved on.
  const base = Math.max(lastMs, Date.parse("2026-11-01T09:01:00Z"))
  const at = (ms) => () => new Date(ms)
  const raw = (o) => JSON.stringify({ session_id: C1, transcript_path: "/x", cwd: "/work/shop", model: "gpt-5", ...o })
  assert.equal(recordCodexHook({ raw: raw({ hook_event_name: "PermissionRequest", turn_id: "t1", tool_name: "Bash", tool_input: { command: "npm i", description: "install deps" } }), hooksDir, now: at(base + 10_000) }), true)
  const s = src(base + 30_000, { hooksDir })
  const w = (await s.listItems()).find((i) => i.id === C1)
  assert.deepEqual([w.status, w.waiting], ["waiting", true])
  const item = await s.getItem(C1)
  assert.deepEqual([item.lanes[0].status, item.lanes[0].reason], ["waiting", "Codex needs your approval to use Bash: install deps"])
  recordCodexHook({ raw: raw({ hook_event_name: "PostToolUse", tool_name: "Bash" }), hooksDir, now: at(base + 15_000) })
  const after = (await src(base + 30_000, { hooksDir }).listItems()).find((i) => i.id === C1)
  assert.equal(after.waiting, false)
  assert.notEqual(after.status, "waiting")
  const line = JSON.parse(readFileSync(join(hooksDir, "codex", `${C1}.jsonl`), "utf8").split("\n")[0])
  assert.deepEqual([line.event, line.codexEvent, line.tool], ["Notification", "PermissionRequest", "Bash"])
})

test("hook codex: unknown events, bad ids and garbage are ignored; the block lists every mapped event", () => {
  const hooksDir = mkdtempSync(join(tmpdir(), "mc-hooks-"))
  assert.equal(recordCodexHook({ raw: JSON.stringify({ session_id: "s", hook_event_name: "SessionStart" }), hooksDir }), false)
  assert.equal(recordCodexHook({ raw: JSON.stringify({ session_id: "../x", hook_event_name: "Stop" }), hooksDir }), false)
  assert.equal(recordCodexHook({ raw: "not json", hooksDir }), false)
  const block = codexHooksBlock({ node: "/usr/bin/node", script: "/work/mc/bin/mission-control.mjs" })
  assert.deepEqual(Object.keys(block.hooks), Object.keys(CODEX_EVENTS))
  assert.equal(block.hooks.PermissionRequest[0].hooks[0].command, "'/usr/bin/node' '/work/mc/bin/mission-control.mjs' hook codex")
})

test("getSession: main and subagent rollouts; traversal refused", async () => {
  const s = src()
  assert.match((await s.getSession(C1, "main.jsonl")).text, /Add a cart page/)
  assert.match((await s.getSession(C1, `agent-${SUB}.jsonl`)).text, /looks fine/)
  assert.equal(await s.getSession(C1, "agent-nope.jsonl"), null)
  for (const name of ["../x", "/etc/passwd", `${C2}.jsonl`, "x.txt", ""]) assert.equal(await s.getSession(C1, name), null, name)
  for (const id of ["../x", "/etc", "..", ""]) assert.equal(await s.getSession(id, "main.jsonl"), null, id)
})

test("confinement: a symlink pointing out of the root is never read", async () => {
  const outside = mkdtempSync(join(tmpdir(), "mc-out-"))
  writeFileSync(join(outside, "secret.jsonl"), '{"timestamp":"2026-11-01T00:00:00Z","type":"session_meta","payload":{"id":"leak","cwd":"/leak"}}\n')
  const r = mkdtempSync(join(tmpdir(), "mc-cx-"))
  mkdirSync(join(r, "2026", "11", "01"), { recursive: true })
  symlinkSync(join(outside, "secret.jsonl"), join(r, "2026", "11", "01", "rollout-evil.jsonl"))
  const s = create({ root: r })
  assert.deepEqual(await s.listItems(), [])
  assert.equal(await s.getItem("evil"), null)
})

test("robustness: missing root, empty and garbage files never throw; a half-written line is skipped", async () => {
  assert.deepEqual(await create({ root: join(tmpdir(), "mc-no-codex-xyz") }).listItems(), [])
  const r = mkdtempSync(join(tmpdir(), "mc-cx-"))
  mkdirSync(join(r, "2026", "11", "01"), { recursive: true })
  writeFileSync(join(r, "2026", "11", "01", "rollout-empty.jsonl"), "")
  writeFileSync(join(r, "2026", "11", "01", "rollout-junk.jsonl"), "not json\n[1]\nnull\n{")
  const s = create({ root: r })
  assert.deepEqual((await s.listItems()).map((i) => i.id).sort(), ["empty", "junk"])
  assert.deepEqual((await s.getItem("junk")).summary.counts, { lanes: 1, calls: 0, errors: 0 })
  const acc = rolloutAcc()
  for (const e of lines('{"timestamp":"2026-11-01T00:00:00Z","type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":"{}","call_id":"a"}}\n{"timestamp":"x","type":"response_it')) acc.feed(e)
  assert.equal(acc.result().calls.length, 1)
})

test("usage: rows per day, session and model in the asked time zone; subagent files fold into their session", async () => {
  const s = src()
  await s.usage({})
  await s.whenScanned()
  const rows = await s.usage({ tz: "UTC" })
  const key = (r) => `${r.day}|${r.session}|${r.model}`
  assert.deepEqual(rows.map(key).sort(), [`2026-11-01|${C1}|gpt-5`, `2026-11-01|${C1}|gpt-5-mini`, `2026-11-02|${C2}|gpt-mystery`])
  const sub = rows.find((r) => r.model === "gpt-5-mini")
  assert.deepEqual([sub.source, sub.harness, sub.project, sub.branch, sub.in, sub.cacheRead], ["codex", "codex", "/work/shop", "feat/cart", 400, 100])
  assert.equal(rows.find((r) => r.model === "gpt-mystery").cost, 0)
  const ny = await s.usage({ tz: "America/New_York", from: "2026-11-01", to: "2026-11-01" })
  assert.deepEqual(ny.map((r) => r.day), ["2026-11-01", "2026-11-01"]) // 09:00Z is still Nov 1 in New York; 08:00Z Nov 2 is 03:00 Nov 2
  assert.equal(s.usageStatus().complete, true)
})

test("cache: an unchanged session is not parsed again", async () => {
  const reads = []
  const s = src(undefined, { onParse: (p, r) => reads.push(r) })
  await s.getItem(C1)
  const n = reads.length
  await s.getCalls(C1)
  await s.getItem(C1)
  assert.equal(reads.length, n)
})

test("CLI args: codex on only when ~/.codex/sessions exists; --codex-dir overrides; --no-codex disables", async () => {
  const home = mkdtempSync(join(tmpdir(), "mc-home-"))
  assert.equal(await loadCodex([], process.cwd(), home), null)
  mkdirSync(join(home, ".codex", "sessions"), { recursive: true })
  assert.equal((await loadCodex([], process.cwd(), home)).name, "codex")
  const over = await loadCodex(["--codex-dir", root], process.cwd(), home)
  assert.equal((await over.listItems()).length, 2)
  assert.equal(await loadCodex(["--no-codex", "--codex-dir", root], process.cwd(), home), null)
  assert.equal(parseArgs(["--no-codex"]).noCodex, true)
  await assert.rejects(async () => parseArgs(["--codex-dir"]), /needs a value/)
})

test("works through the registry next to other sources", async () => {
  const reg = createRegistry([src()])
  assert.equal((await reg.list()).length, 2)
  assert.equal((await reg.get("codex", C1)).summary.source, "codex")
  assert.equal((await reg.calls("codex", C1, { kind: "mcp" })).length, 1)
  assert.equal((await reg.turns("codex", C1, "main", {})).total, 2)
})

test("ready: a Codex turn that ended (Stop hook) is ready for 30 minutes, then just idle; an Interrupt is not ready", async () => {
  const hooksDir = mkdtempSync(join(tmpdir(), "mc-hooks-"))
  const base = Math.max(lastMs, Date.parse("2026-11-01T09:01:00Z"))
  const raw = (o) => JSON.stringify({ session_id: C1, cwd: "/work/shop", ...o })
  recordCodexHook({ raw: raw({ hook_event_name: "Stop" }), hooksDir, now: () => new Date(base + 10_000) })
  const soon = (await src(base + 20 * 60_000, { hooksDir }).listItems()).find((i) => i.id === C1)
  assert.deepEqual([soon.ready, soon.status, soon.waiting, soon.readySince], [true, "idle", false, new Date(base + 10_000).toISOString()])
  const ov = await createRegistry([src(base + 20 * 60_000, { hooksDir })]).overview()
  assert.equal(ov.counts.ready, 1)
  assert.deepEqual(ov.ready.map((r) => r.id), [C1])
  assert.equal(ov.needsYou.length, 0)
  const late = (await src(base + 31 * 60_000, { hooksDir }).listItems()).find((i) => i.id === C1)
  assert.equal(late.ready, undefined)
  recordCodexHook({ raw: raw({ hook_event_name: "Interrupt" }), hooksDir, now: () => new Date(base + 20_000) })
  const cut = (await src(base + 60_000, { hooksDir }).listItems()).find((i) => i.id === C1)
  assert.equal(cut.ready, undefined)
})

test("v2.2 waiting: parallel tools — a sibling call's hooks do not clear an open approval keyed by call id", async () => {
  const hooksDir = mkdtempSync(join(tmpdir(), "mc-hooks-"))
  const base = Math.max(lastMs, Date.parse("2026-11-01T09:01:00Z"))
  const at = (ms) => () => new Date(ms)
  const raw = (o) => JSON.stringify({ session_id: C1, cwd: "/work/shop", ...o })
  const rec = (o, ms) => recordCodexHook({ raw: raw(o), hooksDir, now: at(base + ms) })
  rec({ hook_event_name: "PreToolUse", tool_name: "Read", tool_use_id: "call_b" }, 1_000)
  rec({ hook_event_name: "PermissionRequest", tool_name: "Bash", tool_use_id: "call_a", tool_input: { description: "rm build" } }, 2_000)
  rec({ hook_event_name: "PostToolUse", tool_name: "Read", tool_use_id: "call_b" }, 3_000) // the sibling finishes
  const line = JSON.parse(readFileSync(join(hooksDir, "codex", `${C1}.jsonl`), "utf8").split("\n")[1])
  assert.equal(line.callId, "call_a")
  let w = (await src(base + 30_000, { hooksDir }).listItems()).find((i) => i.id === C1)
  assert.deepEqual([w.status, w.waiting], ["waiting", true], "sibling PostToolUse must not clear call_a's wait")
  rec({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_use_id: "call_a" }, 4_000) // approved: call_a starts
  w = (await src(base + 30_000, { hooksDir }).listItems()).find((i) => i.id === C1)
  assert.equal(w.waiting, false)
})

test("v2.2 waiting: keyed waits — two open approvals need both answered; Stop clears all; unkeyed events keep the old rule", async () => {
  const { waitingFromHooks } = await import("../src/hooks.mjs")
  const N = (callId, ts) => ({ event: "Notification", message: `ask ${callId}`, callId, ts })
  const P = (callId) => ({ event: "PreToolUse", ...(callId ? { callId } : {}) })
  assert.deepEqual(waitingFromHooks([N("a", "t1"), N("b", "t2"), P("b")]), { waiting: true, message: "ask a", since: "t1", callId: "a" })
  assert.equal(waitingFromHooks([N("a", "t1"), N("b", "t2"), P("b"), P("a")]).waiting, false)
  assert.equal(waitingFromHooks([N("a", "t1"), N("b", "t2"), { event: "Stop" }]).waiting, false)
  assert.equal(waitingFromHooks([N("a", "t1"), P()]).waiting, false, "a tool event with no id clears as before")
  assert.equal(waitingFromHooks([{ event: "Notification", message: "x" }, P("zz")]).waiting, false, "an unkeyed wait clears on any tool event")
})

test("v2.2: CODEX_HOME moves the default sessions dir; --codex-dir still wins", async () => {
  const home = mkdtempSync(join(tmpdir(), "mc-home-"))
  const codexHome = mkdtempSync(join(tmpdir(), "mc-codexhome-"))
  // CODEX_HOME set but no sessions dir there: off (the ~/.codex default is not consulted)
  mkdirSync(join(home, ".codex", "sessions"), { recursive: true })
  assert.equal(await loadCodex([], process.cwd(), home, { CODEX_HOME: codexHome }), null)
  mkdirSync(join(codexHome, "sessions"), { recursive: true })
  const s = await loadCodex([], process.cwd(), home, { CODEX_HOME: codexHome })
  assert.equal(s.describe().source, join(codexHome, "sessions"))
  assert.equal((await loadCodex([], process.cwd(), home, {})).describe().source, join(home, ".codex", "sessions"))
  assert.equal((await loadCodex(["--codex-dir", root], process.cwd(), home, { CODEX_HOME: codexHome })).describe().source, root)
})

test("v2.2 prices: current OpenAI models from the official pricing page (short-context Standard rates)", () => {
  const m = (model) => openaiPrice(model)
  assert.deepEqual(m("gpt-5.6-sol"), { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 })
  assert.deepEqual(m("gpt-6.1-sol"), { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 })
  assert.deepEqual(m("gpt-5.5"), { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 5 })
  assert.deepEqual(m("gpt-5.4-mini"), { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0.75 })
  assert.ok(m("gpt-6-astra") && m("gpt-5.6-luna") && m("gpt-5.6-terra") && m("gpt-5.4"))
  assert.equal(m("gpt-reserve"), null, "not on the pricing page: unpriced")
  assert.equal(costOf("gpt-reserve", { in: 1e6, out: 1e6, cacheRead: 0, cacheWrite: 0 }), 0)
})

test("v2.2 waiting: a sibling call's output in the rollout does not end a keyed wait; the waited call's output does", async () => {
  const { appendFileSync } = await import("node:fs")
  const r = mkdtempSync(join(tmpdir(), "mc-cx-"))
  const dir = join(r, "2026", "11", "02")
  mkdirSync(dir, { recursive: true })
  const id = "55555555-5555-4555-8555-555555555555"
  const file = join(dir, `rollout-2026-11-02T10-00-00-${id}.jsonl`)
  const T = Date.parse("2026-11-02T10:00:00Z")
  const at = (s) => new Date(T + s * 1000).toISOString()
  writeFileSync(file, [
    JSON.stringify({ timestamp: at(0), type: "session_meta", payload: { id, cwd: "/w" } }),
    JSON.stringify({ timestamp: at(1), type: "response_item", payload: { type: "function_call", name: "shell", arguments: "{}", call_id: "call_a" } }),
    JSON.stringify({ timestamp: at(1), type: "response_item", payload: { type: "function_call", name: "read", arguments: "{}", call_id: "call_b" } }),
  ].join("\n") + "\n")
  const hooksDir = mkdtempSync(join(tmpdir(), "mc-hooks-"))
  recordCodexHook({ raw: JSON.stringify({ session_id: id, hook_event_name: "PermissionRequest", tool_name: "shell", tool_use_id: "call_a" }), hooksDir, now: () => new Date(T + 2000) })
  const waiting = async () => (await create({ root: r, hooksDir, now: () => T + 60_000 }).listItems())[0].waiting
  assert.equal(await waiting(), true)
  appendFileSync(file, JSON.stringify({ timestamp: at(10), type: "response_item", payload: { type: "function_call_output", call_id: "call_b", output: "ok" } }) + "\n")
  assert.equal(await waiting(), true, "the sibling finishing is not the session moving on")
  appendFileSync(file, JSON.stringify({ timestamp: at(20), type: "response_item", payload: { type: "function_call_output", call_id: "call_a", output: "ok" } }) + "\n")
  assert.equal(await waiting(), false)
})
