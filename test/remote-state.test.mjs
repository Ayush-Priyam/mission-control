import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clampWaitSeconds, isPidAlive, isTsNetHost, publishServer, readConfigFile, readServer, readWaitSeconds, remoteDir, remoteDirFromEnv, startHeartbeat, validateRemote, writeJsonAtomic, writeJsonExclusive, writeRemoteEnabled } from "../src/remote/state.mjs"

const home = () => mkdtempSync(join(tmpdir(), "mc-home-"))
const info = (o = {}) => ({ pid: process.pid, port: 4319, remotePort: 4330, host: "a.ts.net", waitSeconds: 120, enabled: true, startedAt: new Date().toISOString(), ...o })

test("remoteDir and env resolution never fall back to the real home when a temp dir is given", () => {
  assert.equal(remoteDir("/h"), join("/h", ".mission-control", "remote"))
  assert.equal(remoteDirFromEnv({ MISSION_CONTROL_REMOTE_DIR: "/r" }), "/r")
  assert.equal(remoteDirFromEnv({ MISSION_CONTROL_HOME: "/h" }), join("/h", ".mission-control", "remote"))
  assert.equal(remoteDirFromEnv({ MISSION_CONTROL_HOOKS_DIR: "/x/.mission-control/hooks" }), join("/x/.mission-control", "remote"))
})

test("atomic writes: dir 0700, file 0600, no temp files left; exclusive write wins once", () => {
  const dir = join(remoteDir(home()))
  const p = join(dir, "a.json")
  writeJsonAtomic(p, { a: 1 })
  assert.equal(statSync(dir).mode & 0o777, 0o700)
  assert.equal(statSync(p).mode & 0o777, 0o600)
  assert.deepEqual(JSON.parse(readFileSync(p, "utf8")), { a: 1 })
  const q = join(dir, "x.decision.json")
  assert.equal(writeJsonExclusive(q, { n: 1 }), true)
  assert.equal(writeJsonExclusive(q, { n: 2 }), false)
  assert.deepEqual(JSON.parse(readFileSync(q, "utf8")), { n: 1 })
  assert.equal(statSync(q).mode & 0o777, 0o600)
  assert.ok(readdirSync(dir).every((n) => !n.endsWith(".tmp")))
})

test("isPidAlive: this process yes, a nonsense pid no", () => {
  assert.equal(isPidAlive(process.pid), true)
  assert.equal(isPidAlive(0), false)
  assert.equal(isPidAlive(2 ** 22 + 12345), false)
})

test("readServer: fresh and live -> info; stale after 6 s, dead pid, missing or garbage -> null", () => {
  const dir = remoteDir(home())
  assert.equal(readServer(dir), null)
  publishServer(dir, info())
  const now = Date.now()
  assert.equal(readServer(dir, { now }).host, "a.ts.net")
  assert.equal(readServer(dir, { now: now + 7000 }), null, "stale heartbeat")
  assert.equal(readServer(dir, { now, isAlive: () => false }), null, "dead pid")
  writeFileSync(join(dir, "server.json"), "{nope")
  assert.equal(readServer(dir, { now }), null)
})

test("heartbeat re-publishes (mtime moves) and removes server.json on stop", async () => {
  const dir = remoteDir(home())
  const hb = startHeartbeat(dir, () => info(), { everyMs: 20 })
  const p = join(dir, "server.json")
  const t = new Date(Date.now() - 60_000)
  utimesSync(p, t, t)
  await new Promise((r) => setTimeout(r, 80))
  assert.ok(Date.now() - statSync(p).mtimeMs < 1000)
  hb.stop({ remove: true })
  assert.throws(() => statSync(p))
})

test("readWaitSeconds: integer 10–600, default 120; missing or broken config means the default", () => {
  const h = home()
  const cfg = join(h, ".mission-control", "config.json")
  assert.equal(readWaitSeconds(cfg), 120)
  mkdirSync(join(h, ".mission-control"), { recursive: true })
  for (const [v, want] of [[30, 30], [10, 10], [600, 600], [9, 120], [601, 120], [12.5, 120], ["60", 120]]) {
    writeFileSync(cfg, JSON.stringify({ remote: { waitSeconds: v } }))
    assert.equal(readWaitSeconds(cfg), want, String(v))
  }
  writeFileSync(cfg, "{broken")
  assert.equal(readWaitSeconds(cfg), 120)
  assert.equal(clampWaitSeconds(undefined), 120)
})

test("writeRemoteEnabled keeps other keys; refuses an unparseable config without touching it", () => {
  const h = home()
  const cfg = join(h, ".mission-control", "config.json")
  mkdirSync(join(h, ".mission-control"), { recursive: true })
  writeFileSync(cfg, JSON.stringify({ hide: ["x"], remote: { host: "a.ts.net", port: 4331 } }))
  writeRemoteEnabled(cfg, true)
  assert.deepEqual(JSON.parse(readFileSync(cfg, "utf8")), { hide: ["x"], remote: { host: "a.ts.net", port: 4331, enabled: true } })
  writeFileSync(cfg, "{broken")
  assert.throws(() => writeRemoteEnabled(cfg, false), (e) => e.key === "config.json")
  assert.equal(readFileSync(cfg, "utf8"), "{broken")
  assert.equal(readConfigFile(cfg).ok, false)
})

test("validateRemote and isTsNetHost: host must be <name>.ts.net, port 1–65535 and not the dashboard's", () => {
  assert.equal(isTsNetHost("laptop.tail1234.ts.net"), true)
  for (const h of ["ts.net", "evil.com", "a.ts.net.evil.com", "A.TS.NET", "a..ts.net", "-a.ts.net"]) assert.equal(isTsNetHost(h), false, h)
  assert.equal(validateRemote({ host: null, port: 4330, dashboardPort: 4319 }).key, "remote.host")
  assert.match(validateRemote({ host: null, port: 4330, dashboardPort: 4319, configPath: "/c.json" }).error, /remote\.host.*\/c\.json/)
  assert.equal(validateRemote({ host: "a.ts.net", port: 4319, dashboardPort: 4319 }).key, "remote.port")
  assert.equal(validateRemote({ host: "a.ts.net", port: 70000, dashboardPort: 4319 }).key, "remote.port")
  assert.equal(validateRemote({ host: "a.ts.net", port: 4330, dashboardPort: 4319 }), null)
})
