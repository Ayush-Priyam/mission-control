import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import create from "../src/sources/claude-code/index.mjs"
import { parseTurns } from "../src/sources/claude-code/parse.mjs"
import { createServer } from "../src/server.mjs"

const fixtures = fileURLToPath(new URL("./fixtures/claude/projects", import.meta.url))
const j = (o) => JSON.stringify(o)
const at = (s) => `2026-11-02T09:00:${String(s).padStart(2, "0")}.000Z`

test("parseTurns: user and assistant turns, tool chips with input and result, one turn per message id", () => {
  const text = [
    j({ type: "summary", summary: "x" }),
    j({ type: "user", timestamp: at(0), message: { role: "user", content: "add a cart" } }),
    j({ type: "user", timestamp: at(0), isMeta: true, message: { role: "user", content: "meta noise" } }),
    j({ type: "assistant", timestamp: at(1), message: { id: "m1", content: [{ type: "text", text: "Looking." }] } }),
    j({ type: "assistant", timestamp: at(1), message: { id: "m1", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "npm test" } }] } }),
    j({ type: "assistant", timestamp: at(1), message: { id: "m1", content: [{ type: "tool_use", id: "t2", name: "mcp__ctx__docs", input: { q: "routing" } }] } }),
    j({ type: "user", timestamp: at(3), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "1 failing", is_error: true }] } }),
    j({ type: "user", timestamp: at(4), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", content: [{ type: "text", text: "docs" }] }] } }),
    j({ type: "assistant", timestamp: at(5), message: { id: "m2", content: [{ type: "text", text: "Fixed." }] } }),
    '{"type":"assistant","timestamp":"2026-11-02T09:00:0', // half-written
  ].join("\n")
  const turns = parseTurns(text)
  assert.deepEqual(turns.map((t) => [t.i, t.role, t.text]), [[0, "user", "add a cart"], [1, "assistant", "Looking."], [2, "assistant", "Fixed."]])
  const [bash, mcp] = turns[1].tools
  assert.deepEqual([bash.id, bash.name, bash.kind, bash.summary, bash.ok, bash.error, bash.durationMs], ["t1", "Bash", "tool", "npm test", false, "1 failing", 2000])
  assert.deepEqual(bash.input, { command: "npm test" })
  assert.deepEqual([mcp.kind, mcp.server, mcp.name, mcp.ok, mcp.result], ["mcp", "ctx", "docs", true, "docs"])
  assert.equal(turns[0].ts, at(0))
})

test("getTurns: newest page by default, earlier pages with before, subagent lanes, bad lanes refused", async () => {
  const root = mkdtempSync(join(tmpdir(), "mc-turns-"))
  mkdirSync(join(root, "-w", "big", "subagents"), { recursive: true })
  const lines = []
  for (let n = 0; n < 250; n++) lines.push(j({ type: n % 2 ? "assistant" : "user", timestamp: at(n % 60), message: n % 2 ? { id: `m${n}`, content: [{ type: "text", text: `a${n}` }] } : { role: "user", content: `u${n}` } }))
  writeFileSync(join(root, "-w", "big.jsonl"), lines.join("\n"))
  writeFileSync(join(root, "-w", "big", "subagents", "agent-x1.jsonl"), j({ type: "user", timestamp: at(1), message: { role: "user", content: "sub task" } }))
  const s = create({ root, now: () => Date.now() })
  const last = await s.getTurns("big", "main", { limit: 100 })
  assert.deepEqual([last.total, last.start, last.turns.length, last.turns[0].i, last.turns.at(-1).text], [250, 150, 100, 150, "a249"])
  const earlier = await s.getTurns("big", "main", { before: 150, limit: 100 })
  assert.deepEqual([earlier.start, earlier.turns.length, earlier.turns.at(-1).i], [50, 100, 149])
  const first = await s.getTurns("big", "main", { before: 50, limit: 100 })
  assert.deepEqual([first.start, first.turns.length], [0, 50])
  const sub = await s.getTurns("big", "agent-x1", {})
  assert.deepEqual(sub.turns.map((t) => t.text), ["sub task"])
  for (const lane of ["../big", "agent-../../x", "/etc/passwd", "agent-nope", ""]) assert.equal(await s.getTurns("big", lane, {}), null, lane)
  assert.equal(await s.getTurns("../big", "main", {}), null)
})

test("route: /api/item/:source/:id/turns pages a session, 400 on a bad lane, 404 for a source without turns", async () => {
  const src = create({ root: fixtures, now: () => Date.now() })
  const stub = { name: "stub", harness: "stub", listItems: async () => [], getItem: async () => null, getCalls: async () => [], getSession: async () => null }
  const distDir = mkdtempSync(join(tmpdir(), "mc-dist-"))
  writeFileSync(join(distDir, "index.html"), "<h1>ok</h1>")
  const srv = await createServer([src, stub], { port: 0, distDir })
  const base = `http://127.0.0.1:${srv.port}`
  try {
    const r = await fetch(`${base}/api/item/claude-code/s1/turns?lane=main&limit=2`)
    assert.equal(r.status, 200)
    const page = await r.json()
    assert.equal(page.turns.length, 2)
    assert.equal(page.start, page.total - 2)
    const sub = await (await fetch(`${base}/api/item/claude-code/s1/turns?lane=agent-a1`)).json()
    assert.equal(sub.turns[0].text, "review it")
    assert.equal((await fetch(`${base}/api/item/claude-code/s1/turns?lane=..%2Fx`)).status, 400)
    assert.equal((await fetch(`${base}/api/item/claude-code/s1/turns?lane=main&before=-1`)).status, 400)
    assert.equal((await fetch(`${base}/api/item/claude-code/nope/turns?lane=main`)).status, 404)
    assert.equal((await fetch(`${base}/api/item/stub/x/turns?lane=main`)).status, 404)
  } finally { await srv.close() }
})
