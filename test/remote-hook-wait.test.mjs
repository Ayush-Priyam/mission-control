// The hook side of remote answering, end to end through bin/mission-control.mjs with temp homes only.
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { createPairingToken, redeemToken } from "../src/remote/pairing.mjs"
import { decide, pendingDir, readPending } from "../src/remote/prompts.mjs"
import { publishServer, startHeartbeat, writeJsonExclusive } from "../src/remote/state.mjs"

const bin = fileURLToPath(new URL("../bin/mission-control.mjs", import.meta.url))
const fixture = (n) => JSON.parse(readFileSync(new URL(`./fixtures/remote/${n}.json`, import.meta.url), "utf8"))

function setup({ server = true, enabled = true, device = true, waitSeconds = 30 } = {}) {
  const home = mkdtempSync(join(tmpdir(), "mc-home-"))
  const mc = join(home, ".mission-control")
  const remoteDir = join(mc, "remote")
  const hooksDir = join(mc, "hooks")
  mkdirSync(remoteDir, { recursive: true })
  if (device) redeemToken({ remoteDir, token: createPairingToken({ remoteDir, host: "a.ts.net" }).token, ua: "test" })
  const info = () => ({ pid: process.pid, port: 4319, remotePort: 4330, host: "a.ts.net", waitSeconds, enabled, startedAt: new Date().toISOString() })
  const hb = server ? startHeartbeat(remoteDir, info, { everyMs: 300 }) : null
  const env = { ...process.env, MISSION_CONTROL_HOME: home, MISSION_CONTROL_HOOKS_DIR: hooksDir }
  delete env.MISSION_CONTROL_REMOTE_DIR
  return { home, remoteDir, hooksDir, env, stop: () => hb?.stop({ remove: true }) }
}

/** Spawn the hook; resolves { stdout, code, ms }. */
function hook(env, args, input) {
  return new Promise((ok) => {
    const t0 = Date.now()
    const c = spawn(process.execPath, [bin, "hook", ...args], { env })
    let stdout = ""
    c.stdout.on("data", (d) => (stdout += d))
    c.on("close", (code) => ok({ stdout, code, ms: Date.now() - t0, child: c }))
    c.stdin.end(JSON.stringify(input))
    hook.last = c
  })
}

async function pendingOf(remoteDir, ms = 5000) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    let names = []
    try { names = readdirSync(pendingDir(remoteDir)).filter((n) => /^[0-9a-f-]{36}\.json$/.test(n)) } catch { /* not yet */ }
    if (names.length) return readPending(remoteDir, names[0].slice(0, -5))
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error("no pending prompt appeared")
}

const permIn = (o = {}) => ({ session_id: "sess1", hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: "npm test" }, ...o })
const askIn = () => ({ session_id: "sess1", hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_input: { questions: fixture("claude-ask").hookSpecificOutput.updatedInput.questions } })
const logLines = (hooksDir, sub = "") => readFileSync(join(hooksDir, sub, "sess1.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
const noPending = (remoteDir) => !existsSync(pendingDir(remoteDir)) || readdirSync(pendingDir(remoteDir)).length === 0

for (const [name, opts] of [["server down", { server: false }], ["remote off", { enabled: false }], ["no paired device", { device: false }]]) {
  test(`fail open: ${name} -> records the line, empty stdout, exit 0 at once`, async () => {
    const s = setup(opts)
    try {
      const r = await hook(s.env, ["PermissionRequest"], permIn())
      assert.deepEqual([r.stdout, r.code], ["", 0])
      assert.ok(r.ms < 3000, `took ${r.ms} ms`)
      assert.equal(logLines(s.hooksDir).at(-1).event, "PermissionRequest")
      assert.ok(noPending(s.remoteDir))
    } finally { s.stop() }
  })
}

test("fail open: a stale heartbeat (server.json older than 6 s) -> empty, exit 0", async () => {
  const s = setup({ server: false })
  publishServer(s.remoteDir, { pid: process.pid, port: 4319, remotePort: 4330, host: "a.ts.net", waitSeconds: 30, enabled: true, startedAt: "x" })
  const old = new Date(Date.now() - 10_000)
  utimesSync(join(s.remoteDir, "server.json"), old, old)
  const r = await hook(s.env, ["PermissionRequest"], permIn())
  assert.deepEqual([r.stdout, r.code], ["", 0])
  assert.ok(noPending(s.remoteDir))
})

test("subagent PermissionRequest and other events never wait", async () => {
  const s = setup()
  try {
    for (const [ev, input] of [["PermissionRequest", permIn({ agent_id: "agent-1" })], ["PreToolUse", { session_id: "sess1", hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } }], ["Notification", { session_id: "sess1", hook_event_name: "Notification", message: "hi" }], ["PermissionRequest", permIn({ tool_name: "ExitPlanMode" })]]) {
      const r = await hook(s.env, [ev], input)
      assert.deepEqual([r.stdout, r.code], ["", 0], ev)
      assert.ok(r.ms < 3000)
    }
    // an AskUserQuestion with a multiSelect question is not answerable from a phone: no wait
    const q = askIn(); q.tool_input.questions[0].multiSelect = true
    const r = await hook(s.env, ["PreToolUse"], q)
    assert.deepEqual([r.stdout, r.ms < 3000], ["", true])
    assert.ok(noPending(s.remoteDir))
  } finally { s.stop() }
})

test("timeout: nobody answers within waitSeconds -> empty stdout, exit 0, pending removed", async () => {
  const s = setup({ waitSeconds: 1 })
  try {
    const r = await hook(s.env, ["PermissionRequest"], permIn())
    assert.deepEqual([r.stdout, r.code], ["", 0])
    assert.ok(r.ms >= 900 && r.ms < 5000, `took ${r.ms}`)
    assert.ok(noPending(s.remoteDir))
    assert.ok(!logLines(s.hooksDir).some((l) => l.event === "RemoteAnswered"))
  } finally { s.stop() }
})

for (const [decision, name] of [["allow", "claude-permission-allow"], ["deny", "claude-permission-deny"]]) {
  test(`Claude ${decision} from a phone -> exact fixture output plus a RemoteAnswered line`, async () => {
    const s = setup()
    try {
      const running = hook(s.env, ["PermissionRequest"], permIn())
      const p = await pendingOf(s.remoteDir)
      assert.deepEqual([p.harness, p.kind, p.tool, p.target, p.sessionId], ["claude-code", "permission", "Bash", "npm test", "sess1"])
      assert.equal(decide({ remoteDir: s.remoteDir, hooksDir: s.hooksDir, promptId: p.promptId, bind: p.bind, decision, device: "d" }).ok, true)
      const r = await running
      assert.equal(r.code, 0)
      assert.deepEqual(JSON.parse(r.stdout), fixture(name))
      assert.equal(logLines(s.hooksDir).at(-1).event, "RemoteAnswered")
      assert.ok(noPending(s.remoteDir))
    } finally { s.stop() }
  })
}

test("Claude AskUserQuestion: opening Notification, then the picked labels as updatedInput.answers (fixture)", async () => {
  const s = setup()
  try {
    const running = hook(s.env, ["PreToolUse"], askIn())
    const p = await pendingOf(s.remoteDir)
    assert.equal(p.kind, "ask")
    const ev = logLines(s.hooksDir).map((l) => [l.event, l.kind ?? null])
    assert.deepEqual(ev, [["PreToolUse", null], ["Notification", "ask_user_question"]])
    const answers = fixture("claude-ask").hookSpecificOutput.updatedInput.answers
    assert.equal(decide({ remoteDir: s.remoteDir, hooksDir: s.hooksDir, promptId: p.promptId, bind: p.bind, decision: { answers }, device: "d" }).ok, true)
    const r = await running
    assert.deepEqual(JSON.parse(r.stdout), fixture("claude-ask"))
    assert.equal(logLines(s.hooksDir).at(-1).event, "RemoteAnswered")
  } finally { s.stop() }
})

for (const [decision, name] of [["allow", "codex-permission-allow"], ["deny", "codex-permission-deny"]]) {
  test(`Codex ${decision} -> fixture output and a RemoteAnswered line keyed by the call id`, async () => {
    const s = setup()
    try {
      const running = hook(s.env, ["codex"], permIn({ tool_use_id: "call_a" }))
      const p = await pendingOf(s.remoteDir)
      assert.deepEqual([p.harness, p.callId], ["codex", "call_a"])
      decide({ remoteDir: s.remoteDir, hooksDir: s.hooksDir, promptId: p.promptId, bind: p.bind, decision, device: "d" })
      const r = await running
      assert.deepEqual(JSON.parse(r.stdout), fixture(name))
      const last = logLines(s.hooksDir, "codex").at(-1)
      assert.deepEqual([last.event, last.callId], ["RemoteAnswered", "call_a"])
    } finally { s.stop() }
  })
}

test("abandon (remote turned off or answered in the terminal) -> empty stdout, exit 0", async () => {
  const s = setup()
  try {
    const running = hook(s.env, ["PermissionRequest"], permIn())
    const p = await pendingOf(s.remoteDir)
    writeJsonExclusive(join(pendingDir(s.remoteDir), `${p.promptId}.decision.json`), { decision: "abandon", ts: new Date().toISOString() })
    const r = await running
    assert.deepEqual([r.stdout, r.code], ["", 0])
    assert.ok(r.ms < 5000)
  } finally { s.stop() }
})

test("terminal answer seen in the log while waiting -> the hook gives up, empty", async () => {
  const s = setup()
  try {
    const running = hook(s.env, ["PermissionRequest"], permIn())
    await pendingOf(s.remoteDir)
    appendFileSync(join(s.hooksDir, "sess1.jsonl"), JSON.stringify({ event: "PostToolUse", sessionId: "sess1", ts: new Date(Date.now() + 5).toISOString() }) + "\n")
    const r = await running
    assert.deepEqual([r.stdout, r.code], ["", 0])
  } finally { s.stop() }
})

test("outcome B guard: a clear lands just before a decision -> the decision is discarded, nothing printed", async () => {
  const s = setup()
  try {
    const running = hook(s.env, ["PermissionRequest"], permIn())
    const p = await pendingOf(s.remoteDir)
    // Both in the same poll window: the log clear, then a decision file written past decide()'s own check.
    appendFileSync(join(s.hooksDir, "sess1.jsonl"), JSON.stringify({ event: "PermissionDenied", sessionId: "sess1", ts: new Date(Date.now() + 5).toISOString() }) + "\n")
    writeJsonExclusive(join(pendingDir(s.remoteDir), `${p.promptId}.decision.json`), { decision: "allow", device: "d", ts: new Date().toISOString() })
    const r = await running
    assert.deepEqual([r.stdout, r.code], ["", 0])
    assert.ok(!logLines(s.hooksDir).some((l) => l.event === "RemoteAnswered"))
  } finally { s.stop() }
})

test("SIGTERM while waiting (harness timeout or terminal answer kills the hook) -> pending removed, exit 0, empty", async () => {
  const s = setup()
  try {
    const running = hook(s.env, ["PermissionRequest"], permIn())
    await pendingOf(s.remoteDir)
    hook.last.kill("SIGTERM")
    const r = await running
    assert.deepEqual([r.stdout, r.code], ["", 0])
    assert.ok(noPending(s.remoteDir))
  } finally { s.stop() }
})

test("server stops mid-wait (heartbeat goes stale) -> the hook exits empty within about 6 s", async () => {
  const s = setup()
  const running = hook(s.env, ["PermissionRequest"], permIn())
  await pendingOf(s.remoteDir)
  s.stop() // removes server.json
  const r = await running
  assert.deepEqual([r.stdout, r.code], ["", 0])
  assert.ok(r.ms < 8000)
})

test("hooks install: timeouts from remote.waitSeconds + 15, no onFailure, re-merge and re-trust notes", () => {
  const home = mkdtempSync(join(tmpdir(), "mc-home-"))
  mkdirSync(join(home, ".mission-control"), { recursive: true })
  writeFileSync(join(home, ".mission-control", "config.json"), JSON.stringify({ remote: { waitSeconds: 45 } }))
  const env = { ...process.env, MISSION_CONTROL_HOME: home }
  const c = spawnSync(process.execPath, [bin, "hooks", "install"], { env, encoding: "utf8" })
  const block = JSON.parse(c.stdout)
  assert.equal(block.hooks.PermissionRequest[0].hooks[0].timeout, 60)
  assert.equal(block.hooks.PreToolUse[0].hooks[0].timeout, 60)
  assert.ok(!c.stdout.includes("onFailure"))
  assert.match(c.stderr, /merge this one again/)
  const x = spawnSync(process.execPath, [bin, "hooks", "install", "codex"], { env, encoding: "utf8" })
  const cb = JSON.parse(x.stdout)
  assert.equal(cb.hooks.PermissionRequest[0].hooks[0].timeout, 60)
  assert.equal(cb.hooks.Stop[0].hooks[0].timeout, 10)
  assert.ok(!x.stdout.includes("onFailure"))
  assert.match(x.stderr, /\/hooks/)
})
