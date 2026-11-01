import { test } from "node:test"
import assert from "node:assert/strict"
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import create from "../src/adapters/native.mjs"

const runsDir = fileURLToPath(new URL("./fixtures/runs", import.meta.url))
const T0 = Date.parse("2026-11-01T09:40:00Z")

test("lists runs newest first with summaries", async () => {
  const runs = await create({ runsDir }).listRuns()
  assert.deepEqual(runs.map((r) => r.id), ["20261101-1000-bare", "20261101-0930-stopped", "20261101-0900-done"])
  assert.deepEqual(runs[0].stages, {})
  assert.equal(runs[1].repo, "/work/farewell-wt")
  assert.equal(runs[2].repo, "/work/greeter")
})

test("I2: summaries carry waiting from the shared stop rule", async () => {
  const runs = await create({ runsDir }).listRuns()
  assert.deepEqual(runs.map((r) => r.waiting), [false, true, false])
  const d = mkdtempSync(join(tmpdir(), "mc-wait-"))
  const run = (id, lines) => {
    mkdirSync(join(d, id))
    writeFileSync(join(d, id, "state.json"), JSON.stringify({ idea: id, stages: { qa: { status: "stopped" } } }))
    writeFileSync(join(d, id, "runs.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n"))
  }
  run("a-budget", [{ ts: "2026-11-01T09:00:00Z", type: "stop", stage: "qa", rule: "budget" }])
  run("b-answered", [{ ts: "2026-11-01T09:00:00Z", type: "stop", stage: "qa", rule: "human" }, { ts: "2026-11-01T09:01:00Z", type: "human.input", text: "ok" }])
  const by = Object.fromEntries((await create({ runsDir: d }).listRuns()).map((r) => [r.id, r.waiting]))
  assert.deepEqual(by, { "a-budget": false, "b-answered": false })
})

test("bare run has no events", async () => {
  const r = await create({ runsDir }).getRun("20261101-1000-bare")
  assert.deepEqual(r.events, [])
})

test("live by recent events, ended by run.end", async () => {
  const at = (min) => create({ runsDir, now: () => T0 + min * 60_000 })
  assert.equal((await at(5).getRun("20261101-0930-stopped")).live, true)
  assert.equal((await at(11).getRun("20261101-0930-stopped")).live, false)
  for (const m of [0, 5, 500]) assert.equal((await at(m).getRun("20261101-0900-done")).live, false)
})

test("live by lock pid", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "mc-native-"))
  cpSync(runsDir, tmp, { recursive: true })
  writeFileSync(join(tmp, "20261101-0900-done", "run.lock"), String(process.pid))
  const a = create({ runsDir: tmp, now: () => T0 + 86_400_000 })
  assert.equal((await a.getRun("20261101-0900-done")).live, true)
  assert.equal((await a.listRuns()).find((r) => r.id === "20261101-0900-done").live, true)
})

test("session read is confined", async () => {
  const a = create({ runsDir })
  const s = await a.getSession("20261101-0900-done", "backend-1.md")
  assert.match(s.text, /backend-1/)
  assert.equal(await a.getSession("20261101-0900-done", "../state.json"), null)
  assert.equal(await a.getSession("nope", "backend-1.md"), null)
})

test("a jsonl transcript named by a session event is readable", async () => {
  const a = create({ runsDir })
  const run = await a.getRun("20261101-0930-stopped")
  const ev = run.events.find((e) => e.type === "session")
  assert.equal(ev.transcript, "backend-2.jsonl")
  const s = await a.getSession("20261101-0930-stopped", ev.transcript)
  const lines = s.text.trim().split("\n").map((l) => JSON.parse(l))
  assert.equal(lines.length, 4)
  assert.equal(lines[1].message.content[1].name, "Read")
})

test("session symlink outside the sessions dir is refused", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "mc-native-"))
  cpSync(runsDir, tmp, { recursive: true })
  writeFileSync(join(tmp, "outside.md"), "secret")
  const { symlinkSync } = await import("node:fs")
  symlinkSync(join(tmp, "outside.md"), join(tmp, "20261101-0900-done", "sessions", "evil.md"))
  assert.equal(await create({ runsDir: tmp }).getSession("20261101-0900-done", "evil.md"), null)
})

test("missing runs dir lists nothing", async () => {
  assert.deepEqual(await create({ runsDir: "/nonexistent" }).listRuns(), [])
})

test("tokens extra: run with repo and no session events reads transcripts", async () => {
  const home = mkdtempSync(join(tmpdir(), "mc-home-"))
  const repo = join(mkdtempSync(join(tmpdir(), "mc-repo-")), "proj.x")
  const proj = join(home, ".claude", "projects", repo.replaceAll("/", "-").replaceAll(".", "-"))
  mkdirSync(proj, { recursive: true })
  const msg = (o) => JSON.stringify({ sessionId: "s1", timestamp: "2026-11-01T09:00:00Z", message: { usage: o } })
  writeFileSync(join(proj, "s1.jsonl"), [msg({ input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 2, cache_read_input_tokens: 100 }), msg({ input_tokens: 1, output_tokens: 1 })].join("\n"))
  const runs = mkdtempSync(join(tmpdir(), "mc-runs-"))
  for (const [id, withSession] of [["r1", false], ["r2", true], ["r3", null]]) {
    mkdirSync(join(runs, id))
    writeFileSync(join(runs, id, "state.json"), JSON.stringify(withSession === null ? {} : { repo }))
    if (withSession) writeFileSync(join(runs, id, "runs.jsonl"), '{"ts":"2026-11-01T09:00:00Z","type":"session","stage":"a"}\n')
  }
  const a = create({ runsDir: runs, home })
  const r = await a.extras.tokens("r1")
  assert.deepEqual(r.body.total, { input: 11, output: 6, cache_creation: 2, cache_read: 100, billable: 19 })
  assert.equal((await a.extras.tokens("r2")).status, 404)
  assert.equal((await a.extras.tokens("r3")).status, 404)
})
