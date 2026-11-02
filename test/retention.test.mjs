import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRetention } from "../src/retention.mjs"

test("retention: reads and sets only cleanupPeriodDays; never overwrites a broken settings.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "mc-ret-"))
  const r = createRetention(dir)
  assert.deepEqual([r.get().days, r.get().isDefault], [30, true]) // no settings.json: Claude Code's default
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ hooks: { Stop: [] }, model: "opus" }))
  assert.equal(r.set(365).days, 365)
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")), { hooks: { Stop: [] }, model: "opus", cleanupPeriodDays: 365 })
  assert.throws(() => r.set(0), (e) => e.status === 400)
  writeFileSync(join(dir, "settings.json"), "{ broken")
  assert.throws(() => r.set(90), (e) => e.status === 409)
  assert.equal(readFileSync(join(dir, "settings.json"), "utf8"), "{ broken")
})
