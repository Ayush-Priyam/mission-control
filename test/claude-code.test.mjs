import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import create from "../src/sources/claude-code/index.mjs"
import { PRICES, costOf, family } from "../src/sources/claude-code/prices.mjs"
import { parseTranscript } from "../src/sources/claude-code/parse.mjs"
import { createCache } from "../src/sources/claude-code/cache.mjs"
import { spawn } from "node:child_process"
import { createServer as net } from "node:net"
import { loadClaude, parseArgs } from "../src/adapters/load.mjs"
import { createRegistry } from "../src/sources/registry.mjs"

const root = fileURLToPath(new URL("./fixtures/claude/projects", import.meta.url))
const s1Mtime = statSync(join(root, "-work-shop/s1.jsonl")).mtimeMs
const src = (now) => create({ root, now: () => now ?? s1Mtime + 3_600_000 })
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`)

test("list: two sessions with cwd, branch and title, no full parse", async () => {
  const items = await src().listItems()
  assert.equal(items.length, 2)
  const s1 = items.find((i) => i.id === "s1")
  assert.deepEqual([s1.source, s1.kind, s1.harness, s1.cwd, s1.branch, s1.title], ["claude-code", "session", "claude-code", "/work/shop", "feat/cart", "Add a cart page"])
  assert.equal(s1.counts.lanes, 2)
  const s2 = items.find((i) => i.id === "s2")
  assert.deepEqual([s2.cwd, s2.branch, s2.title, s2.counts.lanes], ["/work/shop", "main", "fix the checkout bug", 1])
  assert.equal(s2.startedAt, "2026-11-01T08:00:00.000Z")
})

test("item: main lane plus one subagent lane labelled from meta", async () => {
  const { summary, lanes } = await src().getItem("s1")
  assert.deepEqual(lanes.map((l) => [l.id, l.kind, l.label, l.parent ?? null]), [["main", "main", "main", null], ["agent-a1", "subagent", "Final whole-branch review", "main"]])
  const sub = lanes[1]
  assert.equal(sub.model, "sonnet")
  assert.equal(sub.agentType, "general-purpose")
  assert.equal(sub.status, "done")
  assert.equal(sub.calls, 1)
  assert.deepEqual(summary.counts, { lanes: 2, calls: 6, errors: 1 })
  assert.equal(lanes[0].model, "claude-opus-4-1")
  assert.equal(lanes[0].calls, 5)
  assert.equal(lanes[0].errors, 1)
  assert.equal(summary.title, "Add a cart page")
})

test("calls: mcp, skill, agent link, error, durations; truncated last line skipped", async () => {
  const calls = await src().getCalls("s1")
  const by = Object.fromEntries(calls.map((c) => [c.id, c]))
  assert.equal(calls.length, 6)
  assert.deepEqual([by.toolu_ctx.kind, by.toolu_ctx.server, by.toolu_ctx.name, by.toolu_ctx.durationMs, by.toolu_ctx.ok], ["mcp", "ctx", "query-docs", 4000, true])
  assert.deepEqual([by.toolu_skill.kind, by.toolu_skill.name, by.toolu_skill.durationMs], ["skill", "brainstorming", 2000])
  assert.deepEqual([by.toolu_bash.kind, by.toolu_bash.ok, by.toolu_bash.error, by.toolu_bash.durationMs, by.toolu_bash.summary], ["tool", false, "1 failing", 6000, "npm test"])
  assert.deepEqual([by.toolu_agent.kind, by.toolu_agent.subLane, by.toolu_agent.summary], ["agent", "agent-a1", "Final whole-branch review"])
  assert.equal(by.toolu_sread.lane, "agent-a1")
  assert.equal(by.toolu_sread.durationMs, 5000)
  assert.equal(by.toolu_read.ok, undefined) // no result yet
  assert.deepEqual(calls.map((c) => c.ts), [...calls.map((c) => c.ts)].sort())
})

test("calls: lane, kind and q filters", async () => {
  const s = src()
  assert.deepEqual((await s.getCalls("s1", { lane: "agent-a1" })).map((c) => c.id), ["toolu_sread"])
  assert.deepEqual((await s.getCalls("s1", { kind: "mcp" })).map((c) => c.id), ["toolu_ctx"])
  assert.deepEqual((await s.getCalls("s1", { q: "NPM" })).map((c) => c.id), ["toolu_bash"])
  assert.deepEqual(await s.getCalls("nope"), [])
})

test("nowDoing: the call still without a result, else the last call", async () => {
  const s = src()
  const l1 = (await s.getItem("s1")).lanes
  assert.equal(l1[0].nowDoing.name, "Read")
  assert.equal(l1[0].nowDoing.summary, "/work/shop/src/cart.ts")
  assert.equal(l1[1].nowDoing, undefined) // finished subagent
  const l2 = (await s.getItem("s2")).lanes
  assert.equal(l2[0].nowDoing.name, "Grep")
})

test("tokens count once per assistant message id; cost uses the price table", async () => {
  const { summary, lanes } = await src().getItem("s1")
  assert.deepEqual(lanes[0].tokens, { in: 3500, out: 600, cacheRead: 18000, cacheWrite: 400 })
  near(lanes[0].cost, 0.132)
  near(lanes[1].cost, 0.004455)
  near(summary.cost, 0.136455)
  assert.deepEqual(summary.tokens, { in: 4200, out: 730, cacheRead: 18100, cacheWrite: 500 })
  // After an open, the list carries the totals too.
  const s = src()
  assert.equal((await s.listItems()).find((i) => i.id === "s1").counts.calls, 0)
  await s.getItem("s1")
  const listed = (await s.listItems()).find((i) => i.id === "s1")
  assert.deepEqual([listed.counts.calls, listed.counts.errors, listed.tokens.in], [6, 1, 4200])
})

test("prices: family match, table values, unknown model is free", () => {
  assert.equal(family("claude-opus-4-1-20250805"), "opus")
  assert.equal(family("gpt-x"), null)
  near(costOf("claude-sonnet-4-5", { in: 1e6, out: 1e6, cacheRead: 1e6, cacheWrite: 1e6 }), PRICES.sonnet.input + PRICES.sonnet.output + PRICES.sonnet.cacheRead + PRICES.sonnet.cacheWrite)
  assert.equal(costOf("mystery", { in: 5, out: 5, cacheRead: 5, cacheWrite: 5 }), 0)
  assert.ok(PRICES.opus.output > PRICES.sonnet.output && PRICES.sonnet.output > PRICES.haiku.output)
})

test("live: mtime within two minutes of the injected now", async () => {
  const live = (await src(s1Mtime + 60_000).listItems()).find((i) => i.id === "s1")
  assert.deepEqual([live.live, live.status], [true, "working"])
  assert.equal((await src(s1Mtime + 60_000).getItem("s1")).lanes[0].status, "working")
  const idle = (await src(s1Mtime + 3 * 60_000).listItems()).find((i) => i.id === "s1")
  assert.deepEqual([idle.live, idle.status, idle.waiting], [false, "idle", false])
  assert.equal((await src(s1Mtime + 3 * 60_000).getItem("s1")).summary.status, "idle")
})

test("getSession: main and subagent transcripts; traversal and absolute names refused", async () => {
  const s = src()
  const main = await s.getSession("s1", "main.jsonl")
  assert.match(main.text, /please add a cart page/)
  assert.match((await s.getSession("s1", "agent-a1.jsonl")).text, /looks fine/)
  assert.equal(await s.getSession("s1", "agent-nope.jsonl"), null)
  for (const name of ["../x", "../s2.jsonl", "/etc/passwd", "..%2fx", "agent-../../s2.jsonl", "..jsonl", "s2.jsonl", "x.txt", ""]) {
    assert.equal(await s.getSession("s1", name), null, name)
  }
  for (const id of ["../s1", "-work-shop/s1", "/etc", "..", ""]) assert.equal(await s.getSession(id, "main.jsonl"), null, id)
  assert.equal(await s.getItem("../s1"), null)
})

test("confinement: a symlink pointing out of the root is never read", async () => {
  const outside = mkdtempSync(join(tmpdir(), "mc-out-"))
  writeFileSync(join(outside, "secret.jsonl"), '{"type":"user","cwd":"/leak","message":{"content":"SECRET"}}\n')
  const r = mkdtempSync(join(tmpdir(), "mc-cc-"))
  mkdirSync(join(r, "-p"))
  symlinkSync(join(outside, "secret.jsonl"), join(r, "-p", "evil.jsonl"))
  const s = create({ root: r })
  assert.deepEqual(await s.listItems(), [])
  assert.equal(await s.getSession("evil", "main.jsonl"), null)
  assert.equal(await s.getItem("evil"), null)
})

test("robustness: missing root, empty and garbage files never throw", async () => {
  assert.deepEqual(await create({ root: join(tmpdir(), "mc-does-not-exist-xyz") }).listItems(), []) // no ~/.claude yet is normal
  const r = mkdtempSync(join(tmpdir(), "mc-cc-"))
  mkdirSync(join(r, "-p"))
  writeFileSync(join(r, "-p", "empty.jsonl"), "")
  writeFileSync(join(r, "-p", "junk.jsonl"), "not json\n[1,2]\nnull\n{")
  const s = create({ root: r })
  const items = await s.listItems()
  assert.deepEqual(items.map((i) => i.id).sort(), ["empty", "junk"])
  assert.equal(items[0].title, items[0].id)
  const item = await s.getItem("junk")
  assert.deepEqual([item.lanes.length, item.summary.counts.calls], [1, 0])
})

test("parseTranscript: half-written last line is skipped", () => {
  const p = parseTranscript('{"type":"user","timestamp":"2026-11-02T09:00:00Z","message":{"content":"hi"}}\n{"type":"assistant","message":{"id":"x","content":[{"type":"tool_u')
  assert.deepEqual([p.calls.length, p.meta.title], [0, "hi"])
})

test("cache: keyed by path+size+mtime, evicts the oldest", () => {
  const c = createCache(2)
  const k = (m) => c.key("/f", { size: 1, mtimeMs: m })
  assert.notEqual(k(1), k(2))
  c.set("a", 1); c.set("b", 2); c.get("a"); c.set("c", 3)
  assert.deepEqual([c.get("a"), c.get("b"), c.get("c")], [1, undefined, 3])
})

test("works through the registry like any other source", async () => {
  const reg = createRegistry([src()])
  assert.equal((await reg.list()).length, 2)
  assert.equal((await reg.get("claude-code", "s1")).summary.source, "claude-code")
  assert.equal((await reg.calls("claude-code", "s1", { kind: "skill" })).length, 1)
  assert.match((await reg.session("claude-code", "s1", "main.jsonl")).text, /cart/)
})

test("CLI args: claude on by default under <home>/.claude/projects, --claude-dir overrides, --no-claude disables", async () => {
  const home = mkdtempSync(join(tmpdir(), "mc-home-"))
  mkdirSync(join(home, ".claude", "projects", "-p"), { recursive: true })
  writeFileSync(join(home, ".claude", "projects", "-p", "h1.jsonl"), '{"type":"user","cwd":"/work/h","message":{"content":"from home"}}\n')
  const dflt = await loadClaude([], process.cwd(), home)
  assert.equal(dflt.name, "claude-code")
  assert.deepEqual((await dflt.listItems()).map((i) => i.id), ["h1"])
  const over = await loadClaude(["--claude-dir", root], process.cwd(), home)
  assert.equal((await over.listItems()).length, 2)
  assert.equal(await loadClaude(["--no-claude"], process.cwd(), home), null)
  assert.equal(parseArgs(["--no-claude"]).noClaude, true)
  await assert.rejects(async () => parseArgs(["--claude-dir"]), /needs a value/)
})

test("CLI: --claude-dir serves claude-code sessions through the multi-source API", async () => {
  const probe = net()
  await new Promise((r) => probe.listen(0, "127.0.0.1", r))
  const port = probe.address().port
  await new Promise((r) => probe.close(r))
  const bin = fileURLToPath(new URL("../bin/mission-control.mjs", import.meta.url))
  const child = spawn("node", [bin, "--runs", fileURLToPath(new URL("./fixtures/runs", import.meta.url)), "--claude-dir", root, "--port", String(port), "--no-open"], { env: { ...process.env, HOME: mkdtempSync(join(tmpdir(), "mc-home-")) } }) // warm writes the usage cache under HOME
  try {
    await new Promise((res, rej) => {
      child.stdout.on("data", (d) => String(d).includes("\n") && res())
      child.on("exit", () => rej(new Error("exited")))
    })
    const get = (p) => fetch(`http://localhost:${port}${p}`).then((r) => r.json())
    const items = await get("/api/items")
    assert.deepEqual(items.filter((i) => i.source === "claude-code").map((i) => i.id).sort(), ["s1", "s2"])
    assert.ok(items.some((i) => i.source === "native"))
    const item = await get("/api/item/claude-code/s1")
    assert.equal(item.lanes.length, 2)
    assert.equal((await get("/api/item/claude-code/s1/calls?kind=skill")).length, 1)
    assert.match((await get("/api/item/claude-code/s1/session/agent-a1.jsonl")).text, /looks fine/)
    const bad = await fetch(`http://localhost:${port}/api/item/claude-code/s1/session/..%2Fs2.jsonl`)
    assert.equal(bad.status, 400)
  } finally { child.kill() }
})
