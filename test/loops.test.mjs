import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { LOOP_DEFAULTS, commandOf, detectLoop, errorHead, isCheck, isFileChange, readLoopConfig, runCalls, sinceLastChange } from "../src/loops.mjs"

const T0 = Date.parse("2026-11-02T10:00:00.000Z")
const at = (min) => new Date(T0 + min * 60_000).toISOString()
let n = 0
const bash = (cmd, ok, min, error) => ({ id: `c${++n}`, lane: "main", ts: at(min), name: "Bash", kind: "tool", summary: cmd, input: { command: cmd }, ok, ...(ok === false ? { error: error ?? "1 failing" } : {}) })
const edit = (path, min, ok = true) => ({ id: `c${++n}`, lane: "main", ts: at(min), name: "Edit", kind: "tool", summary: path, input: { file_path: path }, ok })
const read = (path, min) => ({ id: `c${++n}`, lane: "main", ts: at(min), name: "Read", kind: "tool", summary: path, input: { file_path: path }, ok: true })
const msg = (min, tokens, cost = 0.1) => ({ ts: at(min), tokens, cost })

test("helpers: command normalised, checks recognised, edits recognised, error heads mask numbers", () => {
  assert.equal(commandOf(bash("npm   test\n -- --watch=false", false, 0)), "npm test -- --watch=false")
  assert.ok(isCheck(bash("npm test", false, 0)) && isCheck(bash("npx tsc --noEmit", true, 0)) && isCheck(bash("./gradlew assembleDebug", true, 0)))
  assert.ok(!isCheck(bash("ls -la", true, 0)) && !isCheck(edit("/w/test.ts", 0)))
  for (const yes of ["cd web && npm run lint", "CI=1 pnpm test:unit", "yarn build", "make", "make -j4 all", "go test ./...", "cargo clippy", "python -m pytest -q", "npx vitest run", "pytest tests/", "bun run typecheck", "bash -lc 'npm test'"]) assert.ok(isCheck(bash(yes, true, 0)), yes)
  for (const no of ["grep -r test src", "cat build.log", "echo check", "ls tests/", "git checkout main", "rg lint docs", "npm install", "node scripts/make-demo.mjs", "open coverage/test.html", "bash -lc 'ls test'"]) assert.ok(!isCheck(bash(no, true, 0)), no)
  assert.ok(isFileChange(edit("/w/a.ts", 0)) && !isFileChange(edit("/w/a.ts", 0, false)) && !isFileChange(read("/w/a.ts", 0)))
  assert.equal(errorHead("Exit code 1\nFAIL src/a.test.ts (2.31 s)\nmore"), "FAIL src/a.test.ts (# s)")
})

test("(a) the same tool + command failing 4 times in a row is looping, with since, failures, cost since and the first call", () => {
  const calls = [read("/w/a", 0), bash("npm test", false, 1), bash("npm test", false, 2), bash("npm  test", false, 3), bash("npm test", false, 4)]
  const r = detectLoop({ calls, messages: [msg(0, 1000, 1), msg(1, 1000, 0.5), msg(3, 1000, 0.25)], now: T0 + 5 * 60_000 })
  assert.deepEqual([r.looping, r.rule, r.failures, r.firstCallId, r.since, r.costSince, r.reason], [true, "repeat", 4, calls[1].id, at(1), 0.75, "npm test failed 4×"])
  assert.equal(detectLoop({ calls: calls.slice(0, 4), now: T0 }).looping, false, "3 failures are below the threshold")
  assert.equal(detectLoop({ calls, now: T0, config: { repeat: 6 } }).looping, false, "threshold is configurable")
})

test("(a) false positives: a test that fails then passes is not looping; different failing commands are not looping", () => {
  const fixed = [bash("npm test", false, 1), bash("npm test", false, 2), bash("npm test", false, 3), bash("npm test", false, 4), bash("npm test", true, 5)]
  assert.equal(detectLoop({ calls: fixed, now: T0 }).looping, false)
  const varied = [bash("npm test", false, 1), bash("npm run lint", false, 2), bash("npx tsc", false, 3), bash("npm run build", false, 4), bash("cargo test", false, 5)]
  assert.equal(detectLoop({ calls: varied, now: T0 }).looping, false)
})

test("(b) edit -> test -> same failure, 4 cycles, is looping; a different error head each time or a pass is not", () => {
  const cyc = []
  for (let i = 0; i < 4; i++) cyc.push(edit("/w/a.ts", i * 2), bash("npm test", false, i * 2 + 1, `FAIL a.test.ts\nexpected ${i}`))
  const r = detectLoop({ calls: cyc, now: T0 + 9 * 60_000 })
  assert.deepEqual([r.looping, r.rule, r.failures, r.firstCallId], [true, "cycle", 4, cyc[1].id])
  assert.match(r.reason, /npm test failed 4× after edits/)
  const progress = []
  for (let i = 0; i < 4; i++) progress.push(edit("/w/a.ts", i * 2), bash("npm test", false, i * 2 + 1, `FAIL test number-${"abcd"[i]}`))
  assert.equal(detectLoop({ calls: progress, now: T0 }).looping, false, "each failure is a different one: progress")
  assert.equal(detectLoop({ calls: [...cyc, edit("/w/a.ts", 9), bash("npm test", true, 10)], now: T0 }).looping, false, "it passed in the end")
  assert.equal(detectLoop({ calls: cyc.slice(0, 6), now: T0 }).looping, false, "3 cycles are below the threshold")
})

test("tokens since last file change: resets on a successful edit, ignores failed edits, counts from the start with no edit", () => {
  const messages = [msg(0, 100), msg(2, 200), msg(5, 400), msg(8, 800)]
  assert.deepEqual(sinceLastChange({ calls: [read("/w/a", 1)], messages, end: T0 + 10 * 60_000 }), { tokens: 1500, cached: 0, since: at(0), ms: 10 * 60_000 })
  const s = sinceLastChange({ calls: [edit("/w/a.ts", 3)], messages, end: T0 + 10 * 60_000 })
  assert.deepEqual(s, { tokens: 1200, cached: 0, since: at(3), ms: 7 * 60_000 })
  const failed = sinceLastChange({ calls: [edit("/w/a.ts", 3), edit("/w/b.ts", 6, false)], messages, end: T0 + 10 * 60_000 })
  assert.deepEqual(failed, { tokens: 1200, cached: 0, since: at(3), ms: 7 * 60_000 }, "a failed edit changes nothing")
  assert.equal(sinceLastChange({ calls: [edit("/w/a.ts", 3), { ...edit("/w/p", 7), name: "apply_patch" }], messages, end: T0 }).tokens, 800)
  assert.deepEqual(sinceLastChange({}), { tokens: 0, cached: 0, since: null, ms: 0 })
})

test("(c) 300k tokens and 10 min with no file change and no passing check is looping; a passing check or an edit is not", () => {
  const big = [msg(0, 50_000), msg(4, 150_000, 1.5), msg(9, 150_000, 1.5)]
  const calls = [edit("/w/a.ts", 0), bash("npm test", false, 2, "boom"), read("/w/b", 5), bash("node x.js", false, 8, "other")]
  const r = detectLoop({ calls, messages: big, now: T0 + 12 * 60_000 })
  assert.deepEqual([r.looping, r.rule, r.since, r.failures, r.costSince], [true, "burn", at(0), 2, 3])
  assert.match(r.reason, /300k new tok since the last file change/)
  assert.equal(detectLoop({ calls, messages: big, now: T0 + 9 * 60_000 }).looping, false, "under 10 minutes")
  assert.equal(detectLoop({ calls: [...calls, bash("npm test", true, 10)], messages: big, now: T0 + 12 * 60_000 }).looping, false, "a check passed")
  assert.equal(detectLoop({ calls: [...calls, edit("/w/c.ts", 10)], messages: [...big, msg(11, 10)], now: T0 + 12 * 60_000 }).looping, false, "a new file change resets it")
  assert.equal(detectLoop({ calls: [edit("/w/a.ts", 0), read("/w/b", 5)], messages: big, now: T0 + 12 * 60_000 }).looping, false, "quiet reading is not a loop")
  assert.equal(detectLoop({ calls, messages: big, now: T0 + 12 * 60_000, config: { tokens: 1_000_000 } }).looping, false)
})

test("v1 runs: progress + issue events become failing calls; stage.end ok:false is a failed check", () => {
  const ev = []
  for (let i = 0; i < 4; i++) ev.push({ ts: at(i), type: "progress", stage: "backend", tool: "Bash", detail: "npm test" }, { ts: at(i), type: "issue", stage: "backend", summary: "test failed" })
  ev.push({ ts: at(5), type: "session", stage: "backend", tokens: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 900, cache_creation_input_tokens: 3 }, cost: 0.2 })
  const { calls, messages } = runCalls(ev, "backend")
  assert.equal(calls.length, 4)
  assert.ok(calls.every((c) => c.ok === false && c.error === "test failed"))
  assert.deepEqual(messages, [{ ts: at(5), tokens: 18, cached: 900, cost: 0.2 }])
  assert.equal(detectLoop({ calls, messages, now: T0 }).rule, "repeat")
  const ends = runCalls([{ ts: at(1), type: "stage.end", stage: "qa", ok: false, reason: "red" }, { ts: at(2), type: "stage.end", stage: "qa", ok: true }], "qa").calls
  assert.deepEqual(ends.map((c) => [c.ok, isCheck(c)]), [[false, true], [true, true]])
})

test("thresholds come from config.json {loops}; bad values keep the defaults", () => {
  const dir = mkdtempSync(join(tmpdir(), "mc-loops-"))
  const p = join(dir, "config.json")
  writeFileSync(p, JSON.stringify({ loops: { repeat: 6, minutes: "x", tokens: -1 } }))
  assert.deepEqual(readLoopConfig(p), { ...LOOP_DEFAULTS, repeat: 6 })
  assert.deepEqual(readLoopConfig(join(dir, "missing.json")), LOOP_DEFAULTS)
  assert.deepEqual(readLoopConfig(null), LOOP_DEFAULTS)
})

test("(c) counts new tokens only: a large-context session with one failed Read is not looping; with 3 failing checks it is", async () => {
  const { tokenMessages } = await import("../src/loops.mjs")
  // 30 turns over 11 minutes, each 10k new tokens (input + output + cache write) on top of a 200k cached context
  const raw = Array.from({ length: 30 }, (_, i) => ({ ts: at(i * 0.36), model: "m", tokens: { in: 1000, out: 4000, cacheRead: 200_000, cacheWrite: 5000 } }))
  const messages = tokenMessages(raw, () => 0.05)
  const s = sinceLastChange({ calls: [], messages, end: T0 + 11 * 60_000 })
  assert.deepEqual([s.tokens, s.cached], [300_000, 6_000_000], "cache reads are counted apart")
  const now = T0 + 11 * 60_000
  const readFail = { ...read("/w/missing", 3), ok: false, error: "File does not exist." }
  assert.equal(detectLoop({ calls: [read("/w/a", 1), readFail, read("/w/b", 5)], messages, now }).looping, false, "one failed Read, no edits: long read-only work")
  const checks = [bash("npm test", false, 2, "FAIL a"), read("/w/a", 3), bash("npm run lint", false, 5, "lint"), bash("npx tsc --noEmit", false, 8, "TS1")]
  const r = detectLoop({ calls: checks, messages, now })
  assert.deepEqual([r.looping, r.rule, r.failures], [true, "burn", 3])
  const cachedOnly = tokenMessages(raw.map((m) => ({ ...m, tokens: { in: 100, out: 100, cacheRead: 400_000, cacheWrite: 0 } })), () => 0.05)
  assert.equal(detectLoop({ calls: checks, messages: cachedOnly, now }).looping, false, "millions of cache reads alone never trip the threshold")
  assert.equal(detectLoop({ calls: checks, messages: cachedOnly, now, config: { cost: 1 } }).rule, "burn", "an est. cost threshold (config loops.cost) can trip it instead")
})

test("(c) needs 3 failures or a failing check in the stretch: two failed non-check calls are not enough", () => {
  const big = [msg(0, 200_000, 1), msg(9, 200_000, 1)]
  const now = T0 + 12 * 60_000
  const two = [bash("node x.js", false, 2, "a"), bash("node y.js", false, 4, "b")]
  assert.equal(detectLoop({ calls: two, messages: big, now }).looping, false)
  assert.equal(detectLoop({ calls: [...two, bash("node z.js", false, 6, "c")], messages: big, now }).rule, "burn")
})
