import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { turnCosts, whyExpensive } from "../src/turn-costs.mjs"
import { costOf } from "../src/sources/claude-code/prices.mjs"
import createClaude from "../src/sources/claude-code/index.mjs"
import createCodex from "../src/sources/codex/index.mjs"

const m = (i, cr, cw, o = 100, ts = `2026-11-02T10:00:${String(i).padStart(2, "0")}Z`) => ({ model: "claude-sonnet-4-5", ts, tokens: { in: i, out: o, cacheRead: cr, cacheWrite: cw } })

test("turns: context, cost, compaction marker where the context drops sharply, why hints", () => {
  const r = turnCosts([m(10, 0, 30_000), m(5, 30_000, 2_000), m(5, 150_000, 1_000, 9_000), m(5, 0, 0, 0), m(3, 0, 0, 0).tokens && { model: null, ts: null, tokens: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 } }, m(8, 0, 40_000)], costOf)
  assert.equal(r.turns.length, 5, "an all-zero record is not a turn")
  assert.deepEqual(r.turns.map((t) => t.context), [30_010, 32_005, 151_005, 5, 40_008])
  assert.deepEqual(r.turns.map((t) => t.compacted), [false, false, false, true, false])
  assert.equal(r.total.compactions, 1)
  assert.match(r.turns[0].why, /large cache write: new context/)
  assert.match(r.turns[2].why, /high cache read: long context re-read/)
  assert.match(r.turns[2].why, /long output/)
  assert.match(r.turns[3].why, /compacted/)
  assert.equal(whyExpensive({ in: 1, out: 1, cacheRead: 1, cacheWrite: 1 }), null)
  const sum = r.turns.reduce((a, t) => a + t.cost, 0)
  assert.ok(Math.abs(sum - r.total.cost) < 1e-12)
  assert.ok(Math.abs(r.turns[0].cost - (10 * 3 + 100 * 15 + 30_000 * 3.75) / 1e6) < 1e-12)
})

test("sources: Claude Code turns per message id (repeated lines count once); Codex turns per token_count; unknown lane is null", async () => {
  const root = mkdtempSync(join(tmpdir(), "mc-turns-"))
  mkdirSync(join(root, "-w"), { recursive: true })
  const a = (id, u, extra = {}) => JSON.stringify({ type: "assistant", cwd: "/w", timestamp: "2026-11-02T10:00:00Z", message: { id, model: "claude-sonnet-4-5", usage: u, content: [] }, ...extra })
  writeFileSync(join(root, "-w", "s.jsonl"), [a("m1", { input_tokens: 5, cache_creation_input_tokens: 25_000, output_tokens: 10 }), a("m1", { input_tokens: 5, cache_creation_input_tokens: 25_000, output_tokens: 50 }), a("m2", { input_tokens: 3, cache_read_input_tokens: 25_000, output_tokens: 20 })].join("\n") + "\n")
  const c = createClaude({ root })
  const t = await c.getTurnCosts("s", "main")
  assert.deepEqual(t.turns.map((x) => [x.out, x.cacheWrite, x.cacheRead]), [[50, 25_000, 0], [20, 0, 25_000]])
  assert.equal(await c.getTurnCosts("s", "agent-nope"), null)
  assert.equal(await c.getTurnCosts("nope", "main"), null)

  const croot = mkdtempSync(join(tmpdir(), "mc-cturns-"))
  const dir = join(croot, "2026", "11", "02")
  mkdirSync(dir, { recursive: true })
  const id = "44444444-4444-4444-8444-444444444444"
  const tc = (input, cached, out, total) => JSON.stringify({ timestamp: "2026-11-02T10:00:01Z", type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: out }, total_token_usage: { input_tokens: total, cached_input_tokens: 0, output_tokens: 0, total_tokens: total } } } })
  writeFileSync(join(dir, `rollout-2026-11-02T10-00-00-${id}.jsonl`), [
    JSON.stringify({ timestamp: "2026-11-02T10:00:00Z", type: "session_meta", payload: { id, cwd: "/w" } }),
    JSON.stringify({ timestamp: "2026-11-02T10:00:00Z", type: "turn_context", payload: { model: "gpt-5" } }),
    tc(30_000, 0, 100, 30_000), tc(32_000, 30_000, 200, 62_000), tc(32_000, 30_000, 200, 62_000),
  ].join("\n") + "\n")
  const x = await createCodex({ root: croot }).getTurnCosts(id, "main")
  assert.deepEqual(x.turns.map((r) => [r.in, r.cacheRead, r.out]), [[30_000, 0, 100], [2_000, 30_000, 200]], "a repeated total adds no turn")
  assert.ok(x.total.cost > 0)
})
