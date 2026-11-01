import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import create from "../src/adapters/speckit/index.mjs"
import { STAGES } from "../src/adapters/speckit/parse.mjs"

const fixture = fileURLToPath(new URL("./fixtures/speckit", import.meta.url))
const tmpRepo = () => {
  const d = join(mkdtempSync(join(tmpdir(), "mc-sk-")), "repo")
  cpSync(fixture, d, { recursive: true })
  return d
}
const emptyHome = () => mkdtempSync(join(tmpdir(), "mc-home-"))
const at = (p, iso) => { const t = Date.parse(iso) / 1000; utimesSync(p, t, t) }

test("one run per intent with ten stages in order", async () => {
  const repo = tmpRepo()
  at(join(repo, "docs/compound/patterns/one.md"), "2026-11-01T07:00:00Z") // older than tasks.md: no writeback yet
  at(join(repo, "specs/001-tip-split/tasks.md"), "2026-11-01T08:00:00Z")
  const a = create({ repo, home: emptyHome() })
  const runs = await a.listRuns()
  assert.equal(runs.length, 1)
  const r = runs[0]
  assert.equal(r.id, "tip-split")
  assert.equal(r.idea, "Split a restaurant bill and tip fairly between diners")
  assert.equal(r.repo, repo)
  assert.equal(r.harness, "spec-kit-compound")
  assert.equal(r.waiting, false)
  assert.deepEqual(Object.keys(r.stages), STAGES)
  assert.equal(r.stages.intent.status, "done")
  assert.equal(r.stages.gapfill.status, "done")
  assert.equal(r.stages.implement.status, "running")
  assert.equal(r.stages.intentguard.status, "blocked")
  assert.equal(r.stages.writeback.status, "pending")
  assert.equal((await a.getRun("nope")), null)
  at(join(repo, "docs/compound/patterns/one.md"), "2026-11-01T09:00:00Z")
  assert.equal((await a.listRuns())[0].stages.writeback.status, "done")
})

test("stage events follow file mtimes", async () => {
  const repo = tmpRepo()
  const m = {
    "docs/intents/tip-split.intent.md": "2026-11-01T08:00:00Z",
    "docs/expectations/tip-split.expectations.md": "2026-11-01T08:10:00Z",
    "specs/001-tip-split/spec.md": "2026-11-01T08:20:00Z",
    "specs/001-tip-split/plan.md": "2026-11-01T08:30:00Z",
    "specs/001-tip-split/tasks.md": "2026-11-01T08:40:00Z",
    "docs/intents/tip-split.planverify.md": "2026-11-01T08:50:00Z",
    "docs/intents/tip-split.intentguard.md": "2026-11-01T09:00:00Z",
  }
  for (const [p, t] of Object.entries(m)) at(join(repo, p), t)
  const { events } = await create({ repo, home: emptyHome() }).getRun("tip-split")
  assert.ok(events.every((e) => e.approx === true))
  const pick = (type, stage) => events.find((e) => e.type === type && e.stage === stage)?.ts
  assert.equal(pick("stage.start", "intent"), "2026-11-01T08:00:00.000Z")
  assert.equal(pick("stage.end", "intent"), "2026-11-01T08:00:00.000Z")
  assert.equal(pick("stage.start", "expectations"), "2026-11-01T08:00:00.000Z")
  assert.equal(pick("stage.end", "expectations"), "2026-11-01T08:10:00.000Z")
  assert.equal(pick("stage.start", "plan"), "2026-11-01T08:20:00.000Z")
  assert.equal(pick("stage.end", "plan"), "2026-11-01T08:30:00.000Z")
  assert.equal(pick("stage.start", "planverify"), "2026-11-01T08:40:00.000Z")
  assert.equal(pick("stage.end", "intentguard"), "2026-11-01T09:00:00.000Z")
  const ts = events.map((e) => e.ts)
  assert.deepEqual(ts, [...ts].sort())
})

const PINS = {
  "docs/intents/tip-split.intent.md": "2026-11-01T08:00:00Z",
  "docs/expectations/tip-split.expectations.md": "2026-11-01T08:10:00Z",
  "specs/001-tip-split/spec.md": "2026-11-01T08:20:00Z",
  "specs/001-tip-split/plan.md": "2026-11-01T08:30:00Z",
  "specs/001-tip-split/tasks.md": "2026-11-01T08:40:00Z",
  "docs/intents/tip-split.planverify.md": "2026-11-01T08:50:00Z",
  "docs/intents/tip-split.intentguard.md": "2026-11-01T09:00:00Z",
  "docs/compound/patterns/one.md": "2026-11-01T07:00:00Z",
}
const pinAll = (repo) => { for (const [p, t] of Object.entries(PINS)) at(join(repo, p), t) }

function transcriptHome(repo) {
  const home = emptyHome()
  const proj = join(home, ".claude", "projects", repo.replaceAll("/", "-").replaceAll(".", "-"))
  mkdirSync(proj, { recursive: true })
  const line = (usage, ts) => JSON.stringify({ sessionId: "s1", timestamp: ts, message: { model: "claude-sonnet-4-5", role: "assistant", usage } })
  writeFileSync(join(proj, "s1.jsonl"), [
    line({ input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 20, cache_read_input_tokens: 1000 }, "2026-11-01T08:25:00Z"),
    "{ half written",
    line({ input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 500 }, "2026-11-01T08:26:00Z"),
  ].join("\n"))
  return home
}

test("tokens from transcripts under a fake home", async () => {
  const repo = tmpRepo()
  pinAll(repo)
  const home = transcriptHome(repo)
  const a = create({ repo, home })
  const { body } = await a.extras.tokens("tip-split", new URLSearchParams())
  assert.equal(body.available, true)
  assert.deepEqual(body.total, { input: 110, output: 55, cache_creation: 20, cache_read: 1500, billable: 185 })
  assert.equal(body.sessions.length, 1)
  const { events } = await a.getRun("tip-split")
  const s = events.find((e) => e.type === "session")
  assert.equal(s.transcript, "s1.jsonl")
  assert.equal(s.model, "claude-sonnet-4-5")
  assert.equal(s.tokens.input_tokens, 110)
  assert.equal(s.stage, "plan")
  assert.match((await a.getSession("tip-split", "s1.jsonl")).text, /half written/)
  assert.equal(await a.getSession("tip-split", "../s1.jsonl"), null)
  const none = await create({ repo, home: emptyHome() }).extras.tokens("tip-split", new URLSearchParams())
  assert.equal(none.body.available, false)
})

test("doc is confined to the repo", async () => {
  const a = create({ repo: fixture, home: emptyHome() })
  const doc = (p) => a.extras.doc(null, new URLSearchParams({ path: p }))
  assert.equal((await doc("../../etc/hosts")).status, 400)
  assert.equal((await doc("/etc/hosts")).status, 400)
  assert.equal((await doc("package.json")).status, 400)
  assert.equal((await doc("specs/001-tip-split/missing.md")).status, 404)
  assert.match((await doc("specs/001-tip-split/spec.md")).body.content, /Split a bill/)
})

test("doc refuses a symlink that leaves the repo", async () => {
  const repo = tmpRepo()
  const outside = join(mkdtempSync(join(tmpdir(), "mc-out-")), "secret.md")
  writeFileSync(outside, "secret")
  const { symlinkSync } = await import("node:fs")
  symlinkSync(outside, join(repo, "evil.md"))
  const r = await create({ repo, home: emptyHome() }).extras.doc(null, new URLSearchParams({ path: "evil.md" }))
  assert.equal(r.status, 400)
})

test("drift, tasks and diff extras", async () => {
  const a = create({ repo: fixture, home: emptyHome() })
  const d = (await a.extras.drift("tip-split")).body
  assert.equal(d.intentguard.verdict, "BLOCKED")
  assert.equal(d.planverify.verdict, "REPLAN_ALLOWED")
  assert.ok(d.intentguard.drift.length > 0)
  const t = (await a.extras.tasks("tip-split")).body
  assert.equal(t.total, 5)
  assert.equal(t.done, 3)
  assert.equal((await a.extras.drift("nope")).status, 404)
})

const sh = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" } })
function gitRepo() {
  const d = mkdtempSync(join(tmpdir(), "mc-git-"))
  sh(d, "init", "-q", "-b", "main")
  sh(d, "config", "user.email", "t@example.com")
  sh(d, "config", "user.name", "t")
  writeFileSync(join(d, "a.txt"), "one\ntwo\n")
  sh(d, "add", "."); sh(d, "commit", "-q", "-m", "init")
  writeFileSync(join(d, "a.txt"), "one\nTWO\nthree\n")
  writeFileSync(join(d, "new.txt"), "x\ny\n")
  mkdirSync(join(d, "specs")); writeFileSync(join(d, "specs", "ignored.md"), "z")
  return d
}

test("diff extra on a temp git repo", async () => {
  const repo = gitRepo()
  const a = create({ repo, home: emptyHome() })
  const before = sh(repo, "status", "--porcelain", "-uall")
  const d = (await a.extras.diff(null, new URLSearchParams())).body
  assert.equal(d.base.length, 9)
  assert.deepEqual(d.files, [
    { path: "a.txt", add: 2, del: 1, status: "M" },
    { path: "new.txt", add: 0, del: 0, status: "A" },
  ])
  assert.equal(d.count, 2)
  assert.equal(d.additions, 2)
  assert.equal(d.deletions, 1)
  assert.equal(d.text, undefined)
  const f = (await a.extras.diff(null, new URLSearchParams({ full: "1" }))).body
  assert.match(f.text, /\+TWO/)
  assert.match(f.text, /diff --git a\/new.txt b\/new.txt/)
  assert.match(f.text, /\+x\n\+y/)
  assert.doesNotMatch(f.text, /ignored/)
  assert.equal(sh(repo, "status", "--porcelain", "-uall"), before)
})

test("live is scoped to the feature's own files", async () => {
  const repo = tmpRepo()
  pinAll(repo)
  const T = Date.parse("2026-11-01T09:00:00Z")
  const live = async (now) => (await create({ repo, home: emptyHome(), now: () => now }).listRuns())[0].live
  assert.equal(await live(T + 5 * 60_000), true)
  assert.equal(await live(T + 11 * 60_000), false)
  // touching only the shared compound store does not light the feature
  at(join(repo, "docs/compound/patterns/one.md"), "2026-11-01T12:00:00Z")
  assert.equal(await live(Date.parse("2026-11-01T12:01:00Z")), false)
  assert.equal((await create({ repo, home: emptyHome(), now: () => T + 5 * 60_000 }).getRun("tip-split")).live, true)
})

test("a transcript attaches only to the feature whose window contains it", async () => {
  const repo = tmpRepo()
  pinAll(repo)
  mkdirSync(join(repo, "specs/002-other"))
  writeFileSync(join(repo, "docs/intents/other.intent.md"), "# Intent: Other thing\n")
  writeFileSync(join(repo, "specs/002-other/spec.md"), "# Spec\n")
  at(join(repo, "docs/intents/other.intent.md"), "2026-11-02T08:00:00Z")
  at(join(repo, "specs/002-other/spec.md"), "2026-11-02T08:10:00Z")
  const home = transcriptHome(repo) // timestamps 2026-11-01T08:25 -> inside tip-split's plan window
  const a = create({ repo, home })
  const sessions = async (id) => (await a.getRun(id)).events.filter((e) => e.type === "session")
  assert.equal((await sessions("tip-split")).length, 1)
  assert.equal((await sessions("other")).length, 0)
  // still counted at repo level
  assert.equal((await a.extras.tokens(null, new URLSearchParams())).body.total.input, 110)
  // a transcript outside every window attaches to no run
  for (const [f, t] of [["specs/001-tip-split/plan.md", "08:21"], ["specs/001-tip-split/tasks.md", "08:22"],
    ["docs/intents/tip-split.planverify.md", "08:23"], ["docs/intents/tip-split.intentguard.md", "08:24"]]) at(join(repo, f), `2026-11-01T${t}:00Z`)
  assert.equal((await sessions("tip-split")).length, 0)
})

test("repo is untouched", async () => {
  const repo = tmpRepo()
  pinAll(repo)
  const home = transcriptHome(repo)
  const snap = () => {
    const out = {}
    const walk = (d) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n), s = statSync(p)
        if (s.isDirectory()) walk(p)
        else out[p] = [s.mtimeMs, s.size]
      }
    }
    walk(repo)
    return out
  }
  const before = snap()
  const a = create({ repo, home })
  await a.listRuns()
  await a.getRun("tip-split")
  await a.getSession("tip-split", "s1.jsonl")
  const q = (o = {}) => new URLSearchParams(o)
  await a.extras.doc(null, q({ path: "specs/001-tip-split/spec.md" }))
  await a.extras.drift("tip-split")
  await a.extras.tokens("tip-split", q())
  await a.extras.diff(null, q({ full: "1" }))
  await a.extras.tasks("tip-split")
  assert.deepEqual(snap(), before)
  // and a real git repo: status identical before/after every method
  const g = gitRepo()
  const ga = create({ repo: g, home: emptyHome() })
  const st = sh(g, "status", "--porcelain", "-uall"), idx = readFileSync(join(g, ".git", "index"))
  await ga.listRuns(); await ga.extras.diff(null, q()); await ga.extras.diff(null, q({ full: "1" })); await ga.extras.tokens(null, q())
  assert.equal(sh(g, "status", "--porcelain", "-uall"), st)
  assert.deepEqual(readFileSync(join(g, ".git", "index")), idx)
})
