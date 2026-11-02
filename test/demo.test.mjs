import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import create from "../src/sources/claude-code/index.mjs"
import createNative from "../src/adapters/native.mjs"
import { fromAdapter } from "../src/sources/from-adapter.mjs"

const script = fileURLToPath(new URL("../scripts/make-demo.mjs", import.meta.url))
const NOW = Date.parse("2026-11-02T12:00:00.000Z")

test("make-demo: sessions with lanes and calls, one waiting, runs listed", async () => {
  const out = mkdtempSync(join(tmpdir(), "mc-demo-"))
  try {
    execFileSync(process.execPath, [script, "--out", out], { stdio: "pipe" })
    const src = create({ root: join(out, "claude"), hooksDir: join(out, "hooks"), now: () => NOW })
    const items = await src.listItems()
    assert.equal(items.length, 9)
    assert.equal(new Set(items.map((i) => i.cwd)).size, 4, "four working directories: shop, its worktree, app, api")
    assert.ok(items.some((i) => i.branch === "feat/search") && items.some((i) => i.branch === "main"))
    const waiting = items.filter((i) => i.waiting)
    assert.deepEqual(waiting.map((i) => i.id), ["sess-api-waiting"])
    assert.equal(items.filter((i) => i.live).length >= 1, true)
    const search = await src.getItem("sess-search-ui")
    assert.equal(search.lanes.filter((l) => l.kind === "subagent").length, 2)
    assert.ok(search.summary.counts.calls > 5 && search.summary.counts.errors >= 1)
    const calls = await src.getCalls("sess-shop-cart", {})
    assert.ok(calls.some((c) => c.kind === "mcp" && c.server === "docs") && calls.some((c) => c.kind === "skill") && calls.some((c) => c.ok === false))
    // v2.2 demo data: a compaction in the cart session, a demo home with config names, budgets and PRs
    assert.equal((await src.getTurnCosts("sess-shop-cart", "main")).total.compactions, 1)
    const { existsSync, readFileSync } = await import("node:fs")
    assert.ok(existsSync(join(out, "demo-home", ".claude.json")))
    assert.equal(JSON.parse(readFileSync(join(out, "demo-home", ".mission-control", "config.json"), "utf8")).budgets.length, 3)
    assert.equal(JSON.parse(readFileSync(join(out, "demo-prs.json"), "utf8")).length, 2)
    const runs = await fromAdapter(createNative({ runsDir: join(out, "runs"), now: () => NOW })).listItems()
    assert.ok(runs.length >= 5)
  } finally { rmSync(out, { recursive: true, force: true }) }
})

test("make-demo is deterministic for a fixed now", () => {
  const a = mkdtempSync(join(tmpdir(), "mc-demo-")), b = mkdtempSync(join(tmpdir(), "mc-demo-"))
  try {
    for (const d of [a, b]) execFileSync(process.execPath, [script, "--out", d, "--now", "2026-11-02T12:00:00Z"], { stdio: "pipe" })
    const f = "claude/-work-shop/sess-shop-cart.jsonl"
    const read = (d) => execFileSync("cat", [join(d, f)]).toString()
    assert.equal(read(a), read(b))
  } finally { rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }) }
})
