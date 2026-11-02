import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createBudgets, evaluateBudgets, inScope, parseBudgets } from "../src/budgets.mjs"
import { createPrReader, prUsage } from "../src/prs.mjs"

const row = (day, cost, o = {}) => ({ day, cost, source: "claude-code", session: `s${day}`, project: "shop-1", projectName: "shop", projectPath: "/w/shop", worktree: "/w/shop-search", branch: "feat/search", in: 1, out: 1, cacheRead: 0, cacheWrite: 0, ...o })

test("budgets: parse keeps valid entries only; config re-read on change", () => {
  assert.deepEqual(parseBudgets({ budgets: [{ scope: "project", match: "shop", daily: 5, weekly: "x" }, { scope: "team", match: "x", daily: 1 }, { scope: "branch", match: "feat/*", monthly: -1 }, null] }), [{ scope: "project", match: "shop", daily: 5 }])
  assert.deepEqual(parseBudgets(null), [])
  const dir = mkdtempSync(join(tmpdir(), "mc-budget-"))
  const path = join(dir, "config.json")
  const b = createBudgets(path)
  assert.deepEqual(b.list(), [])
  writeFileSync(path, JSON.stringify({ budgets: [{ scope: "branch", match: "main", weekly: 10 }] }))
  assert.equal(b.list().length, 1)
  writeFileSync(path, "{ broken")
  assert.deepEqual(b.list(), [])
  assert.deepEqual(createBudgets(null).list(), [])
})

test("budgets: scope matching by project name/path, worktree path/folder, branch with a trailing glob", () => {
  const r = row("2026-11-02", 1)
  assert.ok(inScope({ scope: "project", match: "shop" }, r))
  assert.ok(inScope({ scope: "project", match: "/w/shop" }, r))
  assert.ok(inScope({ scope: "worktree", match: "shop-search" }, r))
  assert.ok(inScope({ scope: "branch", match: "feat/*" }, r))
  assert.ok(!inScope({ scope: "branch", match: "main" }, r))
})

test("budgets: rolling daily/weekly/monthly spend with 80% warn and 100% over", () => {
  const rows = [row("2026-11-02", 4.5), row("2026-10-30", 4), row("2026-10-10", 50), row("2026-11-02", 9, { branch: "main" })]
  const r = evaluateBudgets([{ scope: "branch", match: "feat/*", daily: 5, weekly: 8, monthly: 100 }], rows, { today: "2026-11-02" })
  const by = Object.fromEntries(r.map((x) => [x.period, x]))
  assert.deepEqual([by.daily.spent, by.daily.level], [4.5, "warn"])
  assert.deepEqual([by.weekly.spent, by.weekly.level], [8.5, "over"])
  assert.deepEqual([by.monthly.spent, by.monthly.level], [58.5, "ok"])
  assert.equal(r[0].period, "weekly", "fullest first")
})

test("PRs: gh output mapped by branch, cached, failures empty and never thrown; usage joined per branch", async () => {
  let calls = 0
  const exec = async (args, cwd) => { calls++; return cwd === "/w/shop" ? JSON.stringify([{ headRefName: "feat/search", number: 42, title: "Search", state: "OPEN" }, { headRefName: "feat/search", number: 7, title: "old" }]) : null }
  const r = createPrReader({ exec, now: () => 0 })
  assert.deepEqual((await r.prsOf("/w/shop")).get("feat/search"), { number: 42, title: "Search", state: "open" })
  await r.prsOf("/w/shop")
  assert.equal(calls, 1, "cached")
  assert.equal(r.available(), true)
  assert.equal((await r.prsOf("/no/gh")).size, 0)
  const bad = createPrReader({ exec: async () => { throw new Error("ENOENT") } })
  assert.equal((await bad.prsOf("/x")).size, 0)
  const u = await prUsage([row("2026-11-02", 2), row("2026-11-01", 1), row("2026-11-01", 5, { branch: "main" })], r)
  assert.deepEqual(u.map((x) => [x.branch, x.pr.number, x.cost, x.sessions]), [["feat/search", 42, 3, 2]])
})
