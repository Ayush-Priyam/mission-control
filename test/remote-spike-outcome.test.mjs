// Pins the hook outputs to test/fixtures/remote/ (the shapes Claude Code and Codex accepted in the spike,
// spec (c) and (e)) and checks the outcome the spike observed: Claude Code 2.1.317 is outcome B (a terminal
// "Yes" leaves the hook running; a terminal "No" cancels it with an uncatchable kill), Codex 0.159.3 is
// outcome C (its approval dialog stays hidden until the hook exits). The *.input.json fixtures are the real
// stdin payloads the spike's hooks received, home path scrubbed. Temp homes only.
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { claudeAskOutput, claudePermissionOutput, codexPermissionOutput, outputFor } from "../src/remote/hook-wait.mjs"
import { createPairingToken, redeemToken } from "../src/remote/pairing.mjs"
import { decide, listPending, pendingDir, readPending } from "../src/remote/prompts.mjs"
import { startHeartbeat } from "../src/remote/state.mjs"

const fixture = (n) => JSON.parse(readFileSync(new URL(`./fixtures/remote/${n}.json`, import.meta.url), "utf8"))
const bin = fileURLToPath(new URL("../bin/mission-control.mjs", import.meta.url))

test("(c) Claude PermissionRequest allow/deny and PreToolUse(AskUserQuestion) outputs equal the fixtures", () => {
  assert.deepEqual(claudePermissionOutput("allow"), fixture("claude-permission-allow"))
  assert.deepEqual(claudePermissionOutput("deny"), fixture("claude-permission-deny"))
  const ask = fixture("claude-ask").hookSpecificOutput.updatedInput
  assert.deepEqual(claudeAskOutput({ questions: ask.questions }, ask.answers), fixture("claude-ask"))
})

test("(e) Codex PermissionRequest allow/deny outputs equal the fixtures; never updatedInput, updatedPermissions or interrupt", () => {
  assert.deepEqual(codexPermissionOutput("allow"), fixture("codex-permission-allow"))
  assert.deepEqual(codexPermissionOutput("deny"), fixture("codex-permission-deny"))
  for (const n of ["claude-permission-allow", "claude-permission-deny", "codex-permission-allow", "codex-permission-deny"]) {
    const text = JSON.stringify(fixture(n))
    for (const k of ["updatedPermissions", "updatedInput", "interrupt", "onFailure", "always"]) assert.ok(!text.includes(k), `${n}: ${k}`)
  }
})

test("outputFor refuses anything that does not fit the prompt (a bad decision file never becomes output)", () => {
  const perm = { kind: "permission" }
  assert.equal(outputFor({ harness: "claude-code", pending: perm, decision: "always" }), "")
  assert.equal(outputFor({ harness: "claude-code", pending: perm, decision: { answers: {} } }), "")
  const questions = fixture("claude-ask").hookSpecificOutput.updatedInput.questions
  const ask = { kind: "ask", questions }
  assert.equal(outputFor({ harness: "claude-code", pending: ask, decision: { answers: { [questions[0].question]: "Nope" } }, toolInput: { questions } }), "")
  assert.equal(outputFor({ harness: "codex", pending: ask, decision: { answers: {} }, toolInput: { questions } }), "", "no Codex option answers")
})

test("the docs record the observed outcomes (Claude Code B, Codex C) and the tested versions", () => {
  const doc = readFileSync(new URL("../docs/remote-answering.md", import.meta.url), "utf8")
  const spike = doc.slice(doc.indexOf("## Spike findings"))
  assert.match(doc, /^## Spike findings$/m)
  for (const o of ["A", "B", "C"]) assert.match(spike, new RegExp(`outcome ${o}`, "i"))
  assert.match(spike, /Claude Code 2\.1\.317/)
  assert.match(spike, /codex-cli 0\.159\.3/)
  assert.match(spike, /\*\*Observed for Claude Code: outcome B\*\*/)
  assert.match(spike, /\*\*Observed for Codex: outcome C\*\*/)
  assert.doesNotMatch(spike, /not run yet/i)
})

// ---- End to end through the bin with the real spike payloads.

function setup() {
  const home = mkdtempSync(join(tmpdir(), "mc-spike-"))
  const remoteDir = join(home, ".mission-control", "remote")
  const hooksDir = join(home, ".mission-control", "hooks")
  mkdirSync(remoteDir, { recursive: true })
  redeemToken({ remoteDir, token: createPairingToken({ remoteDir, host: "a.ts.net" }).token, ua: "test" })
  const info = () => ({ pid: process.pid, port: 4319, remotePort: 4330, host: "a.ts.net", waitSeconds: 30, enabled: true, startedAt: new Date().toISOString() })
  const hb = startHeartbeat(remoteDir, info, { everyMs: 300 })
  const env = { ...process.env, MISSION_CONTROL_HOME: home, MISSION_CONTROL_HOOKS_DIR: hooksDir }
  delete env.MISSION_CONTROL_REMOTE_DIR
  return { remoteDir, hooksDir, env, stop: () => hb.stop({ remove: true }) }
}

function hook(env, args, input) {
  const child = spawn(process.execPath, [bin, "hook", ...args], { env })
  let stdout = ""
  child.stdout.on("data", (d) => (stdout += d))
  const done = new Promise((ok) => child.on("close", (code, signal) => ok({ stdout, code, signal })))
  child.stdin.end(JSON.stringify(input))
  return { child, done }
}

async function pendingOf(remoteDir) {
  const until = Date.now() + 5000
  while (Date.now() < until) {
    let names = []
    try { names = readdirSync(pendingDir(remoteDir)).filter((n) => /^[0-9a-f-]{36}\.json$/.test(n)) } catch { /* not yet */ }
    if (names.length) return readPending(remoteDir, names[0].slice(0, -5))
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error("no pending prompt appeared")
}

const claudePerm = fixture("claude-permission-request.input")
const claudeAsk = fixture("claude-ask.input")
const codexPerm = fixture("codex-permission-request.input")
const logOf = (hooksDir, sub, sid) => readFileSync(join(hooksDir, sub, `${sid}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l))
const tap = (s, p, decision) => decide({ remoteDir: s.remoteDir, hooksDir: s.hooksDir, promptId: p.promptId, bind: p.bind, decision, device: "d" })

test("outcome B (Claude, terminal Yes): the hook keeps waiting; the PostToolUse that follows makes it give up, nothing printed", async () => {
  const s = setup()
  try {
    const h = hook(s.env, ["PermissionRequest"], claudePerm)
    const p = await pendingOf(s.remoteDir)
    assert.equal(p.kind, "permission")
    // The terminal "Yes" runs the tool; Claude Code then sends PostToolUse through the same hook command.
    await new Promise((r) => setTimeout(r, 20))
    const post = spawnSync(process.execPath, [bin, "hook", "PostToolUse"], { env: s.env, input: JSON.stringify({ ...claudePerm, hook_event_name: "PostToolUse" }) })
    assert.equal(post.status, 0)
    const r = await h.done
    assert.deepEqual([r.stdout, r.code], ["", 0])
    assert.ok(!logOf(s.hooksDir, "", claudePerm.session_id).some((l) => l.event === "RemoteAnswered"))
    assert.ok(tap(s, p, "allow").reason, "a late phone tap is refused")
  } finally { s.stop() }
})

test("Claude, terminal No: the hook is killed with no catchable signal; the prompt drops out and a late tap gets \"gone\"", async () => {
  const s = setup()
  try {
    const h = hook(s.env, ["PermissionRequest"], claudePerm)
    const p = await pendingOf(s.remoteDir)
    h.child.kill("SIGKILL")
    const r = await h.done
    assert.equal(r.signal, "SIGKILL")
    assert.deepEqual(listPending({ remoteDir: s.remoteDir, hooksDir: s.hooksDir }), [])
    assert.deepEqual(tap(s, p, "allow"), { reason: "gone" })
  } finally { s.stop() }
})

test("Claude AskUserQuestion, real payload: the phone's pick prints the output Claude Code accepted", async () => {
  const s = setup()
  try {
    const h = hook(s.env, ["PreToolUse"], claudeAsk)
    const p = await pendingOf(s.remoteDir)
    assert.equal(p.kind, "ask")
    const answers = fixture("claude-ask").hookSpecificOutput.updatedInput.answers
    assert.equal(tap(s, p, { answers }).ok, true)
    const r = await h.done
    assert.deepEqual([JSON.parse(r.stdout), r.code], [fixture("claude-ask"), 0])
  } finally { s.stop() }
})

for (const [decision, name] of [["allow", "codex-permission-allow"], ["deny", "codex-permission-deny"]]) {
  test(`Codex, real payload (no call id): ${decision} prints the accepted output, RemoteAnswered unkeyed`, async () => {
    const s = setup()
    try {
      const h = hook(s.env, ["codex"], codexPerm)
      const p = await pendingOf(s.remoteDir)
      assert.deepEqual([p.harness, p.callId], ["codex", undefined])
      assert.equal(tap(s, p, decision).ok, true)
      const r = await h.done
      assert.deepEqual([JSON.parse(r.stdout), r.code], [fixture(name), 0])
      const last = logOf(s.hooksDir, "codex", codexPerm.session_id).at(-1)
      assert.deepEqual([last.event, last.callId], ["RemoteAnswered", undefined])
    } finally { s.stop() }
  })
}
