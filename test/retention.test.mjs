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

test("settings route: a request is applied whole or not at all (retention is not written when start at login cannot run)", async () => {
  const { createServer } = await import("../src/server.mjs")
  const cfg = mkdtempSync(join(tmpdir(), "mc-ret-"))
  writeFileSync(join(cfg, "settings.json"), JSON.stringify({ model: "opus" }))
  const dist = mkdtempSync(join(tmpdir(), "mc-dist-"))
  writeFileSync(join(dist, "index.html"), "ok")
  const src = { name: "claude-code", harness: "claude-code", describe: () => ({ source: join(cfg, "projects") }), listItems: async () => [], getItem: async () => null, getCalls: async () => [], getSession: async () => null }
  const srv = await createServer(src, { port: 0, distDir: dist }) // no autostart: start at login unsupported
  const post = (body) => fetch(`http://127.0.0.1:${srv.port}/api/settings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  try {
    assert.equal((await post({ retentionDays: 90, autostart: true })).status, 501)
    assert.deepEqual(JSON.parse(readFileSync(join(cfg, "settings.json"), "utf8")), { model: "opus" })
    assert.equal((await post({ retentionDays: 90 })).status, 200)
    assert.equal(JSON.parse(readFileSync(join(cfg, "settings.json"), "utf8")).cleanupPeriodDays, 90)
  } finally { await srv.close() }
})
