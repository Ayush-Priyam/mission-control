import { test } from "node:test"
import assert from "node:assert/strict"
import { cpSync, mkdtempSync, writeFileSync } from "node:fs"
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
