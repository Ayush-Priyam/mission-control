// remote setup / doctor on a temp home with a fake tailscale: never the real ~/.claude or tailnet.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mergeHooks, stableNode, plan, runSetup } from "../src/remote/setup.mjs"
import { settingsBlock } from "../src/hooks.mjs"

const NAME = "laptop.tail1234.ts.net"
function fakeTailscale({ state = "Running", serving = false } = {}) {
  const calls = []
  const run = (bin, args) => {
    calls.push([bin, ...args].join(" "))
    if (bin !== "tailscale") return { error: { code: "ENOENT" }, status: null, stdout: "" }
    if (args[0] === "status") return { status: 0, stdout: JSON.stringify({ BackendState: state, Self: { DNSName: `${NAME}.` } }), stderr: "" }
    if (args[0] === "serve" && args[1] === "status") return { status: 0, stdout: serving ? JSON.stringify({ Web: { [`${NAME}:443`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:4330" } } } } }) : "{}" }
    if (args[0] === "serve") { serving = true; return { status: 0, stdout: "" } }
    return { status: 1, stdout: "", stderr: "?" }
  }
  return { run, calls }
}
function home({ settings } = {}) {
  const h = mkdtempSync(join(tmpdir(), "mc-setup-"))
  mkdirSync(join(h, ".claude"), { recursive: true })
  if (settings) writeFileSync(join(h, ".claude", "settings.json"), JSON.stringify(settings, null, 2))
  return { h, configPath: join(h, ".mission-control", "config.json"), done: () => rmSync(h, { recursive: true, force: true }) }
}
const ctxFor = (t, ts, extra = {}) => {
  const lines = []
  const st = { on: false, server: true, devices: 0 }
  const remoteCalls = []
  return {
    lines, st, remoteCalls,
    ctx: { home: t.h, configPath: t.configPath, script: "/mc/bin/mission-control.mjs", run: ts.run, now: () => Date.parse("2026-11-03T07:00:00Z"), port: 4330, execPath: "/usr/bin/node", out: (l) => lines.push(l), err: (l) => lines.push(l), ask: async () => true, yes: false, status: () => st, remote: async (a) => { remoteCalls.push(a.join(" ")); if (a[0] === "on") st.on = true; return 0 }, ...extra },
  }
}

const OWNER_SETTINGS = { model: "opus", hooks: { Notification: [{ matcher: "*", hooks: [{ type: "command", command: "/Users/x/bin/cc-board hook" }] }], PreToolUse: [{ hooks: [{ type: "command", command: "node guard.mjs" }] }] } }

test("mergeHooks keeps every other hook, replaces old Mission Control entries, and is idempotent", () => {
  const old = structuredClone(OWNER_SETTINGS)
  old.hooks.Notification.push({ hooks: [{ type: "command", command: "'/opt/homebrew/Cellar/node/26.1/bin/node' '/mc/bin/mission-control.mjs' hook Notification" }] })
  const block = settingsBlock({ node: "/opt/homebrew/bin/node", script: "/mc/bin/mission-control.mjs", waitSeconds: 120 })
  const { next, changed } = mergeHooks(old, block)
  assert.equal(changed, true)
  assert.equal(next.model, "opus")
  const cmds = next.hooks.Notification.flatMap((g) => g.hooks.map((h) => h.command))
  assert.ok(cmds.includes("/Users/x/bin/cc-board hook"))
  assert.equal(cmds.filter((c) => c.includes("mission-control.mjs")).length, 1)
  assert.ok(!cmds.some((c) => c.includes("Cellar")))
  assert.equal(next.hooks.Notification[0].matcher, "*")
  assert.ok(next.hooks.PreToolUse.some((g) => g.hooks[0].command === "node guard.mjs"))
  assert.equal(next.hooks.PermissionRequest[0].hooks[0].timeout, 135)
  assert.equal(mergeHooks(next, block).changed, false)
})

test("stableNode prefers Homebrew's bin symlink over a versioned Cellar path", () => {
  const real = (p) => (p === "/opt/homebrew/bin/node" ? "/opt/homebrew/Cellar/node/26.10.0_1/bin/node" : p)
  assert.equal(stableNode("/opt/homebrew/Cellar/node/26.10.0_1/bin/node", () => true, real), "/opt/homebrew/bin/node")
  assert.equal(stableNode("/usr/local/bin/node"), "/usr/local/bin/node")
})

test("doctor from zero: reports every missing step with its fix and changes nothing", async () => {
  const t = home({ settings: OWNER_SETTINGS })
  try {
    const before = readFileSync(join(t.h, ".claude", "settings.json"), "utf8")
    const c = ctxFor(t, fakeTailscale())
    assert.equal(await runSetup(c.ctx, { apply: false }), 1)
    const text = c.lines.join("\n")
    assert.match(text, /✓ Tailscale: laptop\.tail1234\.ts\.net/)
    assert.match(text, /✗ Config: remote\.host not set/)
    assert.match(text, /✗ Claude Code hooks/)
    assert.match(text, /✗ tailscale serve[\s\S]*fix: tailscale serve --bg --https=443 http:\/\/127\.0\.0\.1:4330/)
    assert.match(text, /✗ Paired devices: 0[\s\S]*fix: mission-control remote pair/)
    assert.equal(readFileSync(join(t.h, ".claude", "settings.json"), "utf8"), before)
    assert.equal(c.remoteCalls.length, 0)
  } finally { t.done() }
})

test("setup --yes from zero: config, hooks (with backup), serve, on, pair; a second run changes nothing", async () => {
  const t = home({ settings: OWNER_SETTINGS })
  try {
    const ts = fakeTailscale()
    const c = ctxFor(t, ts, { yes: true })
    assert.equal(await runSetup(c.ctx, { apply: true }), 0)
    assert.equal(JSON.parse(readFileSync(t.configPath, "utf8")).remote.host, NAME)
    const s = JSON.parse(readFileSync(join(t.h, ".claude", "settings.json"), "utf8"))
    assert.ok(s.hooks.Notification.some((g) => g.hooks.some((h) => h.command === "/Users/x/bin/cc-board hook")))
    assert.ok(s.hooks.PermissionRequest[0].hooks[0].command.includes("hook PermissionRequest"))
    assert.equal(readdirSync(join(t.h, ".claude")).filter((f) => f.startsWith("settings.json.bak-")).length, 1)
    assert.ok(ts.calls.includes("tailscale serve --bg --https=443 http://127.0.0.1:4330"))
    assert.deepEqual(c.remoteCalls, ["on", "pair"])

    c.st.devices = 1
    c.remoteCalls.length = 0
    const servesBefore = ts.calls.filter((x) => x.startsWith("tailscale serve --bg")).length
    assert.equal(await runSetup(c.ctx, { apply: true }), 0)
    assert.equal(ts.calls.filter((x) => x.startsWith("tailscale serve --bg")).length, servesBefore)
    assert.equal(readdirSync(join(t.h, ".claude")).filter((f) => f.startsWith("settings.json.bak-")).length, 1)
    assert.deepEqual(c.remoteCalls, [])
  } finally { t.done() }
})

test("answering no skips a step and nothing is written for it", async () => {
  const t = home({ settings: OWNER_SETTINGS })
  try {
    const c = ctxFor(t, fakeTailscale(), { ask: async (q) => !q.startsWith("Claude Code hooks") })
    assert.equal(await runSetup(c.ctx, { apply: true }), 1)
    assert.deepEqual(JSON.parse(readFileSync(join(t.h, ".claude", "settings.json"), "utf8")), OWNER_SETTINGS)
    assert.match(c.lines.join("\n"), /- Claude Code hooks: skipped/)
  } finally { t.done() }
})

test("logged-out Tailscale stops setup with the fix; Codex hooks only when ~/.codex exists", async () => {
  const t = home({})
  try {
    const c = ctxFor(t, fakeTailscale({ state: "NeedsLogin" }), { yes: true })
    assert.equal(await runSetup(c.ctx, { apply: true }), 2)
    assert.match(c.lines.join("\n"), /tailscale up/)
    assert.ok(!plan(ctxFor(t, fakeTailscale()).ctx).some((s) => s.key === "codex-hooks"))
    mkdirSync(join(t.h, ".codex"))
    assert.ok(plan(ctxFor(t, fakeTailscale()).ctx).some((s) => s.key === "codex-hooks"))
  } finally { t.done() }
})

test("a settings.json that is not valid JSON is never overwritten", async () => {
  const t = home({})
  try {
    writeFileSync(join(t.h, ".claude", "settings.json"), "{ not json")
    const c = ctxFor(t, fakeTailscale(), { yes: true })
    await runSetup(c.ctx, { apply: true })
    assert.equal(readFileSync(join(t.h, ".claude", "settings.json"), "utf8"), "{ not json")
  } finally { t.done() }
})
