import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import create from "../src/sources/claude-code/index.mjs"
import { parseTranscript } from "../src/sources/claude-code/parse.mjs"
import { fromAdapter } from "../src/sources/from-adapter.mjs"
import { aggregate } from "../src/usage.mjs"
import { createServer } from "../src/server.mjs"
import { loadClaude, usageCachePath } from "../src/adapters/load.mjs"

const root = fileURLToPath(new URL("./fixtures/claude/projects", import.meta.url))
const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), "mc-usage-")))
const U = { tz: "UTC" }
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`)
const counting = () => { const c = { n: 0, parse: (t) => { c.n++; return parseTranscript(t) } }; return c }
const row = (o) => ({ day: "2026-11-01", source: "s", harness: "h", project: "p", worktree: "/w", branch: "main", model: "m", in: 1, out: 1, cacheRead: 0, cacheWrite: 0, cost: 1, sessions: 1, ...o })

test("two fixture sessions on two days: per-day, per-model tokens and cost", async () => {
  const s = create({ root, cachePath: join(tmp(), "usage.json") })
  await s.usage(U)
  await s.whenScanned()
  assert.equal(s.usageStatus().complete, true)
  const rows = await s.usage(U)
  const by = Object.fromEntries(rows.map((r) => [`${r.day}|${r.model}`, r]))
  assert.equal(rows.length, 3) // subagent sonnet usage is its own model row; no duplicate main rows
  const opus = by["2026-11-02|claude-opus-4-1"]
  assert.deepEqual([opus.in, opus.out, opus.cacheRead, opus.cacheWrite], [3500, 600, 18000, 400]) // m1 counted once despite two lines
  near(opus.cost, 0.132)
  const son = by["2026-11-02|claude-sonnet-4-5"]
  assert.deepEqual([son.in, son.out, son.cacheRead, son.cacheWrite], [700, 130, 100, 100])
  near(son.cost, 0.004455)
  const haiku = by["2026-11-01|claude-haiku-4-5"]
  assert.deepEqual([haiku.in, haiku.out], [100, 20])
  near(haiku.cost, 0.0002)
  assert.deepEqual([opus.session, opus.worktree, opus.branch, opus.harness, opus.source], ["s1", "/work/shop", "feat/cart", "claude-code", "claude-code"])
  assert.equal(son.worktree, "/work/shop") // subagent rows inherit the session's cwd and branch
  assert.equal(son.branch, "feat/cart")
  const one = await s.usage({ tz: "UTC", from: "2026-11-02", to: "2026-11-02" })
  assert.equal(one.length, 2)
  const agg = aggregate(rows, { by: "model" })
  near(agg.totals.cost, 0.132 + 0.004455 + 0.0002)
  assert.equal(agg.totals.sessions, 2)
  assert.deepEqual(agg.series.map((d) => [d.day, d.sessions]), [["2026-11-01", 1], ["2026-11-02", 1]])
})

test("a session spanning midnight splits by message timestamp", async () => {
  const r = tmp()
  mkdirSync(join(r, "-p"))
  const msg = (id, ts) => JSON.stringify({ type: "assistant", timestamp: ts, cwd: "/p", sessionId: "x", message: { id, model: "claude-haiku-4-5", usage: { input_tokens: 10, output_tokens: 1 }, content: [] } })
  writeFileSync(join(r, "-p", "x.jsonl"), [msg("a", "2026-11-01T23:59:00.000Z"), msg("b", "2026-11-02T00:01:00.000Z"), msg("b", "2026-11-02T00:02:00.000Z")].join("\n") + "\n")
  const s = create({ root: r })
  await s.usage(U)
  await s.whenScanned()
  const rows = (await s.usage(U)).sort((a, b) => a.day.localeCompare(b.day))
  assert.deepEqual(rows.map((x) => [x.day, x.in, x.session]), [["2026-11-01", 10, "x"], ["2026-11-02", 10, "x"]])
  assert.equal(aggregate(rows).totals.sessions, 1)
})

test("second call reuses the cache: no re-parse, in memory and from the file", async () => {
  const cachePath = join(tmp(), "cache", "usage.json")
  const c = counting()
  const s = create({ root, cachePath, parse: c.parse, now: () => 0 })
  await s.usage(U)
  await s.whenScanned()
  assert.equal(c.n, 3) // s1, its subagent, s2
  const first = await s.usage(U)
  await s.whenScanned()
  assert.equal(c.n, 3)
  assert.deepEqual(await s.usage(U), first)
  // A new process: the persisted file answers, still no parse.
  const c2 = counting()
  const s2 = create({ root, cachePath, parse: c2.parse })
  const early = await s2.usage(U) // loaded from the file before any scan step
  assert.equal(early.length, 3)
  await s2.whenScanned()
  assert.equal(c2.n, 0)
  assert.equal(JSON.parse(readFileSync(cachePath, "utf8")).v, 2)
})

test("only a changed file is parsed again", async () => {
  const r = tmp()
  mkdirSync(join(r, "-p"))
  const msg = (id) => JSON.stringify({ type: "assistant", timestamp: "2026-11-01T10:00:00.000Z", cwd: "/p", message: { id, model: "claude-haiku-4-5", usage: { input_tokens: 5 }, content: [] } })
  writeFileSync(join(r, "-p", "a.jsonl"), msg("1") + "\n")
  writeFileSync(join(r, "-p", "b.jsonl"), msg("2") + "\n")
  const c = counting()
  let t = 0
  const s = create({ root: r, parse: c.parse, now: () => t })
  await s.usage(U); await s.whenScanned()
  assert.equal(c.n, 2)
  writeFileSync(join(r, "-p", "a.jsonl"), msg("1") + "\n" + msg("3") + "\n") // grows: new size
  t = 10_000
  await s.usage(U); await s.whenScanned()
  assert.equal(c.n, 3)
  assert.equal((await s.usage(U)).reduce((n, x) => n + x.in, 0), 15)
})

test("the first call may be partial while scanning, then complete", async () => {
  const s = create({ root })
  const partial = await s.usage(U)
  assert.equal(s.usageStatus().complete, false)
  assert.ok(partial.length < 3)
  await s.whenScanned()
  assert.equal(s.usageStatus().complete, true)
  assert.equal((await s.usage(U)).length, 3)
})

test("aggregate: by model, project, harness, day, worktree, branch; distinct sessions", () => {
  const rows = [
    row({ session: "a", model: "opus", project: "p1", harness: "cc", worktree: "/w1", branch: "main", cost: 2 }),
    row({ session: "a", day: "2026-11-02", model: "haiku", project: "p1", harness: "cc", worktree: "/w1", branch: "main", cost: 1 }),
    row({ session: "b", model: "opus", project: "p2", harness: "ronin", worktree: "/w2", branch: "feat", cost: 4, projectName: "two" }),
  ]
  const keys = (by) => aggregate(rows, { by }).groups.map((g) => [g.key, g.cost, g.sessions])
  assert.deepEqual(keys("model"), [["opus", 6, 2], ["haiku", 1, 1]])
  assert.deepEqual(keys("project"), [["p2", 4, 1], ["p1", 3, 1]])
  assert.deepEqual(keys("harness"), [["ronin", 4, 1], ["cc", 3, 1]])
  assert.deepEqual(keys("day"), [["2026-11-01", 6, 2], ["2026-11-02", 1, 1]])
  assert.deepEqual(keys("worktree"), [["/w2", 4, 1], ["/w1", 3, 1]])
  assert.deepEqual(keys("branch"), [["feat", 4, 1], ["main", 3, 1]])
  assert.equal(aggregate(rows, { by: "project" }).groups[0].name, "two")
  const a = aggregate(rows, { by: "model" })
  assert.deepEqual(a.series[0].byKey, { opus: 6 })
  assert.equal(a.totals.sessions, 2)
  assert.throws(() => aggregate(rows, { by: "nope" }))
  assert.deepEqual(aggregate([], {}), { totals: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0, cost: 0, sessions: 0 }, series: [], groups: [] })
})

test("native runs: usage rows from session events", async () => {
  const events = [
    { type: "session", ts: "2026-11-01T10:00:00Z", stage: "build", model: "m1", tokens: { input_tokens: 10, output_tokens: 5 }, cost: 0.5 },
    { type: "session", ts: "2026-11-02T10:00:00Z", stage: "build", model: "m1", tokens: { input_tokens: 1, output_tokens: 1 }, cost: 0.25 },
    { type: "progress", ts: "2026-11-02T10:01:00Z", stage: "build", tool: "Bash" },
  ]
  const adapter = { name: "native", listRuns: async () => [{ id: "r1" }], getRun: async () => ({ events, state: { repo: "/work/app", branch: "b", stages: {} }, live: false }), getSession: async () => null }
  const rows = await fromAdapter(adapter).usage({ tz: "UTC", from: "2026-11-01", to: "2026-11-02" })
  assert.deepEqual(rows.map((r) => [r.day, r.in, r.out, r.cost, r.worktree, r.branch, r.session, r.model]), [["2026-11-01", 10, 5, 0.5, "/work/app", "b", "r1", "m1"], ["2026-11-02", 1, 1, 0.25, "/work/app", "b", "r1", "m1"]])
  assert.equal((await fromAdapter(adapter).usage({ tz: "UTC", from: "2026-11-02" })).length, 1)
})

test("server: /api/usage by every key, validation, complete flag; start warms the scan", async () => {
  const dist = tmp()
  writeFileSync(join(dist, "index.html"), "<!doctype html>")
  const stub = { resolve: async () => null, worktrees: async () => [], status: async () => null }
  const src = create({ root, cachePath: join(tmp(), "u.json") })
  const srv = await createServer(src, { port: 0, distDir: dist, git: stub })
  const get = (p) => fetch(`http://127.0.0.1:${srv.port}${p}`)
  try {
    for (let i = 0; i < 100 && !src.usageStatus().complete; i++) await new Promise((r) => setTimeout(r, 20)) // no request made yet: the start warmed it
    assert.equal(src.usageStatus().complete, true)
    const body = await (await get("/api/usage?by=model&tz=UTC")).json()
    assert.equal(body.complete, true)
    assert.deepEqual(body.groups.map((g) => g.key), ["claude-opus-4-1", "claude-sonnet-4-5", "claude-haiku-4-5"])
    near(body.totals.cost, 0.132 + 0.004455 + 0.0002)
    const day = await (await get("/api/usage?by=day&tz=UTC&from=2026-11-02&to=2026-11-02")).json()
    assert.deepEqual(day.groups.map((g) => g.key), ["2026-11-02"])
    const proj = await (await get("/api/usage?by=project")).json()
    assert.equal(proj.groups.length, 1)
    assert.equal(proj.groups[0].name, "shop")
    assert.equal(proj.groups[0].sessions, 2)
    const wt = await (await get("/api/usage?by=worktree")).json()
    assert.deepEqual(wt.groups.map((g) => g.key), ["/work/shop"])
    const br = await (await get("/api/usage?by=branch")).json()
    assert.deepEqual(br.groups.map((g) => g.key).sort(), ["feat/cart", "main"])
    assert.equal((await (await get("/api/usage?by=harness")).json()).groups[0].key, "claude-code")
    for (const bad of ["by=x", "from=yesterday", "to=2026-1-1", "from=2026-13-45", "tz=Mars/Olympus", "tz="]) assert.equal((await get(`/api/usage?${bad}`)).status, 400, bad)
  } finally { await srv.close() }
})

const oneMsg = (r, ts, extra = {}) => {
  mkdirSync(join(r, "-p"), { recursive: true })
  writeFileSync(join(r, "-p", "t.jsonl"), JSON.stringify({ type: "assistant", timestamp: ts, cwd: "/p", sessionId: "t", message: { id: "a", model: "claude-haiku-4-5", usage: { input_tokens: 7 }, content: [], ...extra } }) + "\n")
}

test("time zones: buckets are UTC in the cache, days are local at read time", async () => {
  const r = tmp()
  oneMsg(r, "2026-11-01T20:00:00.000Z")
  const s = create({ root: r })
  await s.usage(U); await s.whenScanned()
  const day = async (tz, range = {}) => (await s.usage({ tz, ...range })).map((x) => x.day)
  assert.deepEqual(await day("UTC"), ["2026-11-01"])
  assert.deepEqual(await day("Asia/Kolkata"), ["2026-11-02"]) // 01:30 local
  assert.deepEqual(await day("Asia/Kolkata", { from: "2026-11-02", to: "2026-11-02" }), ["2026-11-02"])
  assert.deepEqual(await day("Asia/Kolkata", { from: "2026-11-01", to: "2026-11-01" }), [])
  assert.deepEqual(await day("America/Los_Angeles"), ["2026-11-01"])
  // +5:45: 18:15Z is 00:00 next day in Kathmandu, 18:14Z is not.
  const k = tmp()
  oneMsg(k, "2026-11-01T18:15:00.000Z")
  const sk = create({ root: k })
  await sk.usage(U); await sk.whenScanned()
  assert.deepEqual((await sk.usage({ tz: "Asia/Kathmandu" })).map((x) => x.day), ["2026-11-02"])
  const k2 = tmp()
  oneMsg(k2, "2026-11-01T18:14:00.000Z")
  const sk2 = create({ root: k2 })
  await sk2.usage(U); await sk2.whenScanned()
  assert.deepEqual((await sk2.usage({ tz: "Asia/Kathmandu" })).map((x) => x.day), ["2026-11-01"])
  // native runs map the same way
  const adapter = { name: "native", listRuns: async () => [{ id: "r" }], getRun: async () => ({ events: [{ type: "session", ts: "2026-11-01T20:00:00Z", model: "m", tokens: { input_tokens: 1 } }], state: {} }), getSession: async () => null }
  assert.equal((await fromAdapter(adapter).usage({ tz: "Asia/Kolkata" }))[0].day, "2026-11-02")
})

test("server: tz param shifts days; the default is the server's zone", async () => {
  const r = tmp()
  oneMsg(r, "2026-11-01T20:00:00.000Z")
  const dist = tmp()
  writeFileSync(join(dist, "index.html"), "<!doctype html>")
  const src = create({ root: r })
  const srv = await createServer(src, { port: 0, distDir: dist, git: { resolve: async () => null, worktrees: async () => [], status: async () => null } })
  try {
    for (let i = 0; i < 100 && !src.usageStatus().complete; i++) await new Promise((x) => setTimeout(x, 20))
    const q = async (p) => (await fetch(`http://127.0.0.1:${srv.port}/api/usage?by=day&${p}`)).json()
    assert.deepEqual((await q("tz=Asia/Kolkata")).groups.map((g) => g.key), ["2026-11-02"])
    assert.deepEqual((await q("tz=UTC")).groups.map((g) => g.key), ["2026-11-01"])
    const dflt = await q("")
    assert.equal(dflt.tz, Intl.DateTimeFormat().resolvedOptions().timeZone)
    assert.equal((await fetch(`http://127.0.0.1:${srv.port}/api/usage?tz=Not/AZone`)).status, 400)
  } finally { await srv.close() }
})

test("bad timestamps fall back to the file mtime; malformed cache entries are dropped", async () => {
  const r = tmp()
  oneMsg(r, "yesterday-ish")
  const s = create({ root: r })
  await s.usage(U); await s.whenScanned()
  const rows = await s.usage(U)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].day, new Date().toISOString().slice(0, 10)) // the file was just written
  const cachePath = join(tmp(), "u.json")
  const good = { b: "2026-11-01T10:00", model: "m", in: 1, out: 1, cacheRead: 0, cacheWrite: 0 }
  writeFileSync(cachePath, JSON.stringify({ v: 2, files: { a: { days: [good] }, b: { days: [{ ...good, in: "x" }] }, c: { days: "no" }, d: null, e: { days: [{ model: "m" }] } } }))
  const c = counting()
  const s2 = create({ root: r, cachePath, parse: c.parse })
  await s2.usage(U); await s2.whenScanned()
  assert.equal(JSON.parse(readFileSync(cachePath, "utf8")).files.a, undefined) // pruned: not a current file
  assert.equal(c.n, 1)
})

test("a file that fails to read mid-rescan keeps its previous result", async () => {
  const r = tmp()
  oneMsg(r, "2026-11-01T10:00:00.000Z")
  let t = 0, fail = false
  const s = create({ root: r, now: () => t, parse: (text) => { if (fail) throw new Error("read"); return parseTranscript(text) } })
  await s.usage(U); await s.whenScanned()
  assert.equal((await s.usage(U))[0].in, 7)
  fail = true
  writeFileSync(join(r, "-p", "t.jsonl"), readFileSync(join(r, "-p", "t.jsonl"), "utf8") + "\n") // new mtime/size
  t = 10_000
  await s.usage(U); await s.whenScanned()
  assert.equal((await s.usage(U))[0]?.in, 7)
})

test("a nonexistent claude dir: complete with no rows", async () => {
  const s = create({ root: join(tmpdir(), "mc-no-such-claude-dir-xyz") })
  assert.deepEqual(await s.usage(U), [])
  await s.whenScanned()
  assert.equal(s.usageStatus().complete, true)
  assert.deepEqual(await s.usage(U), [])
})

test("I1: each claude root has its own usage cache file; a second root never drops the first's entries", async () => {
  const home = tmp()
  const other = tmp()
  mkdirSync(join(other, "-q"))
  writeFileSync(join(other, "-q", "z.jsonl"), JSON.stringify({ type: "assistant", timestamp: "2026-11-01T10:00:00.000Z", cwd: "/q", message: { id: "z", model: "claude-haiku-4-5", usage: { input_tokens: 3 }, content: [] } }) + "\n")
  assert.notEqual(usageCachePath(home, root), usageCachePath(home, other))
  assert.match(usageCachePath(home, root), /\/\.mission-control\/cache\/usage-[0-9a-f]{12}\.json$/)
  const a = await loadClaude(["--claude-dir", root], process.cwd(), home)
  const b = await loadClaude(["--claude-dir", other], process.cwd(), home)
  assert.equal(a.usageCachePath, usageCachePath(home, root))
  await a.usage(U); await a.whenScanned()
  const before = readFileSync(a.usageCachePath, "utf8")
  await b.usage(U); await b.whenScanned()
  assert.equal(readFileSync(a.usageCachePath, "utf8"), before, "root A's cache untouched by root B")
  assert.equal(Object.keys(JSON.parse(readFileSync(b.usageCachePath, "utf8")).files).length, 1)
  // minor 7: private dir and file.
  assert.equal(statSync(dirname(a.usageCachePath)).mode & 0o777, 0o700)
  assert.equal(statSync(a.usageCachePath).mode & 0o777, 0o600)
})
