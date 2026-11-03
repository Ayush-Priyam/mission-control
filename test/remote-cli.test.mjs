import { test } from "node:test"
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { createServer as netServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "../src/adapters/load.mjs"
import { checkRemoteFlags } from "../src/remote/cli.mjs"
import { listDevices, redeemToken } from "../src/remote/pairing.mjs"

const bin = fileURLToPath(new URL("../bin/mission-control.mjs", import.meta.url))
const runs = fileURLToPath(new URL("./fixtures/runs", import.meta.url))
const HOST = "laptop.tail1234.ts.net"

function home(config) {
  const h = mkdtempSync(join(tmpdir(), "mc-home-"))
  mkdirSync(join(h, ".mission-control"), { recursive: true })
  if (config) writeFileSync(join(h, ".mission-control", "config.json"), JSON.stringify(config))
  return h
}
const envOf = (h) => {
  const e = { ...process.env, MISSION_CONTROL_HOME: h, MISSION_CONTROL_HOOKS_DIR: join(h, ".mission-control", "hooks") }
  delete e.MISSION_CONTROL_REMOTE_DIR
  return e
}
const cli = (h, ...args) => spawnSync(process.execPath, [bin, ...args], { env: envOf(h), encoding: "utf8", timeout: 20_000 })
const remoteDir = (h) => join(h, ".mission-control", "remote")

test("parseArgs takes --remote-port and --remote-host as value flags", () => {
  const a = parseArgs(["--remote-port", "4330", "--remote-host", HOST])
  assert.deepEqual([a["remote-port"], a["remote-host"]], ["4330", HOST])
  assert.throws(() => parseArgs(["--remote-port"]), /needs a value/)
})

test("checkRemoteFlags: both or neither; *.ts.net host; port 1–65535 and not --port", () => {
  assert.equal(checkRemoteFlags({ port: 4319 }), null)
  assert.equal(checkRemoteFlags({ remotePort: "4330", remoteHost: HOST, port: 4319 }), null)
  assert.match(checkRemoteFlags({ remotePort: "4330", port: 4319 }), /go together/)
  assert.match(checkRemoteFlags({ remoteHost: HOST, port: 4319 }), /go together/)
  assert.match(checkRemoteFlags({ remotePort: "4330", remoteHost: "laptop.local", port: 4319 }), /ts\.net/)
  assert.match(checkRemoteFlags({ remotePort: "4319", remoteHost: HOST, port: 4319 }), /differs/)
  assert.match(checkRemoteFlags({ remotePort: "abc", remoteHost: HOST, port: 4319 }), /--remote-port/)
})

test("startup: a bad remote flag exits 2 with a message, before anything listens", () => {
  const h = home()
  for (const args of [["--remote-port", "4330"], ["--remote-host", HOST], ["--remote-port", "4330", "--remote-host", "evil.com"], ["--port", "4400", "--remote-port", "4400", "--remote-host", HOST]]) {
    const r = cli(h, "--no-open", "--no-claude", "--no-codex", "--runs", runs, ...args)
    assert.equal(r.status, 2, `${args.join(" ")}: ${r.stderr}`)
    assert.match(r.stderr, /mission control: --remote/)
  }
})

test("remote pair: needs remote.host (exit 2); prints the URL and a QR; only the hash on disk", () => {
  const r0 = cli(home(), "remote", "pair")
  assert.equal(r0.status, 2)
  assert.match(r0.stderr, /remote\.host/)
  const h = home({ remote: { host: HOST } })
  const r = cli(h, "remote", "pair")
  assert.equal(r.status, 0, r.stderr)
  const url = r.stdout.match(/https:\/\/\S+/)[0]
  assert.match(url, new RegExp(`^https://${HOST.replace(/\./g, "\\.")}/pair#t=[A-Za-z0-9_-]{43}$`))
  assert.ok(r.stdout.includes("\u2588"), "QR drawn with blocks")
  assert.match(r.stdout, /10 minutes/)
  const token = url.split("#t=")[1]
  assert.ok(!readFileSync(join(remoteDir(h), "pairing.json"), "utf8").includes(token))
  assert.ok(redeemToken({ remoteDir: remoteDir(h), token, ua: "iPhone Safari" }))
})

test("remote devices and revoke: list, revoke prints what it removed, unknown id exits 1", () => {
  const h = home({ remote: { host: HOST } })
  assert.match(cli(h, "remote", "devices").stdout, /No paired devices/)
  const token = cli(h, "remote", "pair").stdout.match(/#t=([A-Za-z0-9_-]+)/)[1]
  const { device } = redeemToken({ remoteDir: remoteDir(h), token, ua: "Mozilla/5.0 (iPhone) Safari/604.1" })
  assert.match(cli(h, "remote", "devices").stdout, new RegExp(`${device.id}\\s+iPhone Safari\\s+paired `))
  assert.equal(cli(h, "remote", "revoke", "nope").status, 1)
  const ok = cli(h, "remote", "revoke", device.id)
  assert.equal(ok.status, 0)
  assert.match(ok.stdout, new RegExp(`revoked ${device.id}`))
  assert.deepEqual(listDevices({ remoteDir: remoteDir(h) }), [])
  assert.equal(cli(h, "remote", "revoke").status, 2)
  assert.equal(cli(h, "remote", "bogus").status, 2)
})

test("remote on/off/status without a server: validates, persists, audits; status prints the five lines", () => {
  const h = home()
  assert.equal(cli(h, "remote", "status").stdout.trim(), ["remote: off", "host: not set", "port: 4330", "server: not running", "devices: 0"].join("\n"))
  const no = cli(h, "remote", "on")
  assert.equal(no.status, 2)
  assert.match(no.stderr, /remote\.host/)
  assert.equal(existsSync(join(h, ".mission-control", "audit.jsonl")), false)
  writeFileSync(join(h, ".mission-control", "config.json"), JSON.stringify({ hide: ["x"], remote: { host: HOST } }))
  const on = cli(h, "remote", "on")
  assert.equal(on.status, 0)
  assert.match(on.stdout, /takes effect when mission-control starts/)
  assert.deepEqual(JSON.parse(readFileSync(join(h, ".mission-control", "config.json"), "utf8")), { hide: ["x"], remote: { host: HOST, enabled: true } })
  assert.match(cli(h, "remote", "status").stdout, /^remote: on$/m)
  cli(h, "remote", "on") // a no-op adds no audit line
  cli(h, "remote", "off")
  const audit = readFileSync(join(h, ".mission-control", "audit.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
  assert.deepEqual(audit.map((l) => [l.actor, l.action]), [["cli", "remote-on"], ["cli", "remote-off"]])
})

test("startup with --remote-port: listener on, tailscale serve hint and Funnel warning; config untouched; server.json removed on SIGTERM", async () => {
  const rp = await new Promise((ok) => { const s = netServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)) }) })
  const h = home({ hide: [] })
  const before = readFileSync(join(h, ".mission-control", "config.json"), "utf8")
  const child = spawn(process.execPath, [bin, "--no-open", "--no-claude", "--no-codex", "--runs", runs, "--port", "0", "--remote-port", String(rp), "--remote-host", HOST], { env: envOf(h) })
  let out = ""
  child.stdout.on("data", (d) => (out += d))
  child.stderr.on("data", (d) => (out += d))
  const closed = new Promise((r) => child.on("close", r))
  try {
    const until = Date.now() + 15_000
    while (!/funnel/i.test(out) && Date.now() < until) await new Promise((r) => setTimeout(r, 50))
    assert.match(out, new RegExp(`tailscale serve --bg --https=443 http://127\\.0\\.0\\.1:${rp}`))
    assert.match(out, /funnel/i)
    const srv = JSON.parse(readFileSync(join(remoteDir(h), "server.json"), "utf8"))
    assert.deepEqual([srv.enabled, srv.remotePort, srv.host, srv.pid], [true, rp, HOST, child.pid])
  } finally {
    child.kill("SIGTERM")
    await closed
  }
  assert.equal(existsSync(join(remoteDir(h), "server.json")), false)
  assert.equal(readFileSync(join(h, ".mission-control", "config.json"), "utf8"), before)
})
