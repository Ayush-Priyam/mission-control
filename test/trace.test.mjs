import { test } from "node:test"
import assert from "node:assert/strict"
import { buildTrace, safeSessionName } from "../src/trace.mjs"

const B = Date.parse("2026-10-20T10:00:00.000Z")
const ts = (s) => new Date(B + s * 1000).toISOString()
const ev = (s, type, o = {}) => ({ ts: ts(s), type, ...o })
const tok = { input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 30, output_tokens: 5 }
const flat = (spans) => spans.flatMap((s) => [s, ...flat(s.children)])

test("stage > session > tool nest with exact compressed times", () => {
  const tr = buildTrace([
    ev(0, "run.start", { idea: "tip app" }),
    ev(1, "stage.start", { stage: "backend", attempt: 1 }),
    ev(2, "progress", { stage: "backend", tool: "session", detail: "s1" }),
    ev(3, "progress", { stage: "backend", tool: "Read", detail: "a.js" }),
    ev(5, "progress", { stage: "backend", tool: "Bash", detail: "npm test" }),
    ev(8, "session", { stage: "backend", sessionId: "s1", agent: "coder", model: "m", cost: 0.5, tokens: tok, transcript: "sessions/backend-1.md" }),
    ev(9, "stage.end", { stage: "backend", ok: true }),
    ev(9, "run.end", { status: "done" }),
  ])
  assert.equal(tr.title, "tip app")
  const [stage] = tr.spans
  assert.deepEqual([stage.kind, stage.name, stage.t0, stage.t1, stage.realMs], ["stage", "backend", 1000, 9000, 8000])
  const [sess] = stage.children
  assert.deepEqual([sess.kind, sess.t0, sess.t1, sess.realMs, sess.sub], ["session", 2000, 8000, 6000, "m"])
  assert.deepEqual(sess.ref, { transcript: "sessions/backend-1.md" })
  assert.deepEqual(sess.children.map((c) => [c.name, c.t0, c.t1]), [["Read", 3000, 5000], ["Bash", 5000, 8000]])
  assert.equal(tr.endT, 9000)
  assert.equal(stage.cost, 0.5)
  assert.equal(stage.tokensIn, 60)
})

test("a session without a start marker starts at the stage start, then at the previous session's end", () => {
  const tr = buildTrace([
    ev(0, "stage.start", { stage: "qa" }),
    ev(4, "session", { stage: "qa", sessionId: "a", agent: "x" }),
    ev(9, "session", { stage: "qa", sessionId: "b", agent: "x" }),
    ev(10, "stage.end", { stage: "qa", ok: true }),
  ])
  assert.deepEqual(tr.spans[0].children.map((c) => [c.t0, c.t1]), [[0, 4000], [4000, 9000]])
})

test("a tool's end is capped at its session end", () => {
  const tr = buildTrace([
    ev(0, "stage.start", { stage: "qa" }),
    ev(1, "progress", { stage: "qa", tool: "session", detail: "s" }),
    ev(2, "progress", { stage: "qa", tool: "Bash", detail: "x" }),
    ev(3, "session", { stage: "qa", sessionId: "s", agent: "x" }),
    ev(20, "progress", { stage: "qa", tool: "Read", detail: "later" }),
    ev(21, "stage.end", { stage: "qa", ok: true }),
  ], { breakAfterMs: 1e9 })
  const bash = flat(tr.spans).find((s) => s.name === "Bash")
  assert.equal(bash.t1, 3000)
  assert.equal(bash.running, false)
})

test("idle gaps over breakAfterMs compress to breakMs with the real time kept", () => {
  const tr = buildTrace([ev(0, "run.start"), ev(600, "run.resume"), ev(601, "note")])
  assert.deepEqual(tr.breaks, [{ t: 0, realMs: 600000, reason: "idle" }])
  assert.equal(tr.markers.find((m) => m.kind === "resume").t, 4000)
  assert.equal(tr.endT, 5000)
})

test("totals: cost, tokens, llm calls, tool calls, errors, waits", () => {
  const tr = buildTrace([
    ev(0, "stage.start", { stage: "b" }),
    ev(1, "progress", { stage: "b", tool: "Read", detail: "x" }),
    ev(2, "progress", { stage: "b", tool: "Edit", detail: "y" }),
    ev(3, "session", { stage: "b", cost: 0, apiCost: 0.25, tokens: tok }),
    ev(4, "session", { stage: "b", cost: 1, tokens: tok }),
    ev(5, "issue", { stage: "b", decision: { blocks: true } }),
    ev(5, "issue", { stage: "b", decision: { blocks: false } }),
    ev(6, "check", { stage: "b", cmd: "npm test", exitCode: 1 }),
    ev(6, "check", { stage: "b", cmd: "npm test", exitCode: 0 }),
    ev(6, "check", { stage: "b", skipped: true }),
    ev(7, "stop", { stage: "b", rule: "human" }),
  ])
  // The owner stop is a wait, not an error.
  assert.deepEqual(tr.totals, { durationMs: 7000, cost: 1.25, tokensIn: 120, tokensOut: 10, llmCalls: 2, toolCalls: 2, errors: 2, waits: 1 })
  assert.deepEqual(tr.markers.map((m) => m.kind), ["error", "error", "wait"])
})

test("slowest is set on exactly one session", () => {
  const tr = buildTrace([
    ev(0, "stage.start", { stage: "b" }),
    ev(2, "session", { stage: "b" }),
    ev(10, "session", { stage: "b" }),
    ev(11, "stage.end", { stage: "b", ok: true }),
  ])
  const s = flat(tr.spans).filter((x) => x.kind === "session")
  assert.equal(s.filter((x) => x.slowest).length, 1)
  assert.equal(s.find((x) => x.slowest).realMs, 8000)
})

test("status: live, stopped, waiting, done", () => {
  const run = [ev(0, "stage.start", { stage: "b" })]
  assert.equal(buildTrace(run).status, "live")
  assert.equal(buildTrace([...run, ev(1, "stop", { stage: "b" })]).status, "stopped")
  assert.equal(buildTrace([...run, ev(1, "stop", { stage: "b", rule: "budget" }), ev(2, "run.end", { status: "stopped", rule: "budget" })]).status, "stopped")
  assert.equal(buildTrace([...run, ev(1, "stop", { stage: "b", rule: "human" })]).status, "waiting")
  assert.equal(buildTrace([...run, ev(1, "stop", { stage: "b", rule: "human" }), ev(2, "run.end", { status: "stopped", rule: "human" })]).status, "waiting")
  assert.equal(buildTrace([...run, ev(1, "stop", { stage: "b", rule: "human" }), ev(2, "run.resume"), ev(3, "stage.start", { stage: "c" })]).status, "live")
  assert.equal(buildTrace([...run, ev(1, "run.end", { status: "done" })]).status, "done")
  assert.equal(buildTrace([...run, ev(1, "run.end", { status: "stopped" }), ev(1, "published")]).status, "stopped")
})

test("review 1: a session with no stage span goes under a consults group and never throws", () => {
  const tr = buildTrace([
    ev(0, "run.start"),
    ev(10, "session", { stage: "researcher", agent: "ask", cost: 0.1 }),
  ])
  const g = tr.spans.find((s) => s.kind === "group")
  assert.equal(g.name, "consults")
  assert.deepEqual([g.children[0].t0, g.children[0].t1], [9000, 10000])
})

test("review 2: no events, or only run.start, gives zeros and no crash", () => {
  for (const evs of [[], [ev(0, "run.start", { idea: "x" })]]) {
    const tr = buildTrace(evs)
    assert.deepEqual(tr.spans, [])
    assert.deepEqual(tr.totals, { durationMs: 0, cost: 0, tokensIn: 0, tokensOut: 0, llmCalls: 0, toolCalls: 0, errors: 0, waits: 0 })
    assert.equal(tr.endT, 0)
  }
})

test("review 3: a tool before any session in its stage attaches to the stage span", () => {
  const tr = buildTrace([
    ev(0, "stage.start", { stage: "b" }),
    ev(1, "progress", { stage: "b", tool: "Glob", detail: "**" }),
    ev(5, "stage.end", { stage: "b", ok: true }),
  ])
  assert.deepEqual(tr.spans[0].children.map((c) => [c.kind, c.name, c.t0, c.t1]), [["tool", "Glob", 1000, 5000]])
})

test("tools on an open stage with no session run to the next progress, then to the cursor", () => {
  const tr = buildTrace([
    ev(0, "stage.start", { stage: "b" }),
    ev(1, "progress", { stage: "b", tool: "Glob", detail: "**" }),
    ev(5, "progress", { stage: "b", tool: "Read", detail: "x" }),
  ])
  const [glob, read] = tr.spans[0].children
  assert.deepEqual([glob.t0, glob.t1, glob.running], [1000, 5000, false])
  assert.deepEqual([read.t0, read.t1, read.running], [5000, 5000, true])
})

test("a session whose marker and end name different stages is grouped by its own stage, not consults", () => {
  const tr = buildTrace([
    ev(0, "run.start"),
    ev(1, "progress", { stage: "memory", tool: "session", detail: "m1" }),
    ev(4, "session", { stage: "learn", sessionId: "m1", agent: "scribe" }),
    ev(6, "session", { stage: "researcher", agent: "ask" }),
  ])
  assert.deepEqual(tr.spans.map((g) => [g.kind, g.name, g.children.length]).sort(), [["group", "consults", 1], ["group", "learn", 1]])
  assert.equal(tr.spans.find((g) => g.name === "learn").children[0].t0, 1000)
})

test("a session end with no sessionId claims its stage's start marker; an unended marker stops at the next boundary", () => {
  const tr = buildTrace([
    ev(0, "run.start"),
    ev(1, "progress", { stage: "memory", tool: "session", detail: "m1" }),
    ev(3, "profile", { stage: "learn" }),
    ev(4, "progress", { stage: "learn", tool: "session", detail: "l1" }),
    ev(6, "session", { stage: "learn", model: "h", transcript: "sessions/learn-1.md" }),
    ev(8, "progress", { stage: "canary", tool: "session", detail: "c1" }),
    ev(9, "progress", { stage: "canary", tool: "Write", detail: "a.txt" }),
    ev(11, "canary", { ok: true }),
    ev(30, "run.end", { status: "done" }),
  ], { breakAfterMs: 1e9 })
  const all = flat(tr.spans)
  const learn = all.filter((s) => s.kind === "session" && s.name === "learn")
  assert.deepEqual(learn.map((s) => [s.t0, s.t1, s.running]), [[4000, 6000, false]])
  const mem = all.find((s) => s.name === "memory" && s.kind === "session")
  assert.deepEqual([mem.t0, mem.t1, mem.running], [1000, 4000, false])
  const canary = all.find((s) => s.name === "canary" && s.kind === "session")
  assert.deepEqual([canary.t1, canary.running], [11000, false])
  assert.deepEqual(canary.children.map((c) => [c.name, c.t0, c.t1, c.running]), [["Write", 9000, 11000, false]])
  assert.equal(all.filter((s) => s.running).length, 0)
})

test("review 4: a cut run shows open spans as running up to the cursor", () => {
  const all = [
    ev(0, "stage.start", { stage: "b" }),
    ev(1, "progress", { stage: "b", tool: "session", detail: "s" }),
    ev(2, "progress", { stage: "b", tool: "Read", detail: "x" }),
    ev(9, "session", { stage: "b", sessionId: "s", agent: "c" }),
    ev(10, "stage.end", { stage: "b", ok: true }),
  ]
  const cut = buildTrace(all.slice(0, 3))
  const [stage] = cut.spans
  assert.equal(stage.running, true)
  assert.equal(stage.t1, 2000)
  const [sess] = stage.children
  assert.deepEqual([sess.running, sess.t1], [true, 2000])
  assert.deepEqual([sess.children[0].running, sess.children[0].t1], [true, 2000])
  assert.equal(cut.status, "live")
})

test("review 5: a few thousand events build fast", () => {
  const evs = [ev(0, "stage.start", { stage: "b" })]
  for (let i = 1; i <= 5000; i++) evs.push(ev(i, "progress", { stage: "b", tool: "Read", detail: String(i) }))
  const t0 = Date.now()
  const tr = buildTrace(evs)
  assert.equal(tr.totals.toolCalls, 5000)
  assert.ok(Date.now() - t0 < 2000)
})

test("safeSessionName accepts transcript files and rejects traversal", () => {
  assert.equal(safeSessionName("backend-1.md"), true)
  assert.equal(safeSessionName("../x.md"), false)
  assert.equal(safeSessionName("a..b.md"), true)
  assert.equal(safeSessionName("a/b.md"), false)
assert.equal(safeSessionName("s1.jsonl"), true)
  assert.equal(safeSessionName("x.png"), false)
  assert.equal(safeSessionName(undefined), false)
})

test("errors are failures; owner stops are waits", () => {
  const tr = buildTrace([
    ev(0, "stage.start", { stage: "setup" }),
    // A human-owned blocking issue and its stop: one wait, no error.
    ev(1, "issue", { stage: "setup", summary: "kickoff", decision: { blocks: true, owner: "human" } }),
    ev(1, "stop", { stage: "setup", rule: "human", detail: "kickoff" }),
    ev(2, "stage.start", { stage: "qa" }),
    // An agent-owned blocking issue directly followed by its stop counts once.
    ev(3, "issue", { stage: "qa", summary: "E4 fails", decision: { blocks: true, owner: "backend" } }),
    ev(3, "stop", { stage: "qa", rule: "unsure", detail: "E4 fails" }),
    ev(4, "stage.start", { stage: "backend" }),
    // An agent-owned blocking issue on its own counts.
    ev(5, "issue", { stage: "backend", summary: "T1 not changed", decision: { blocks: true, owner: "backend" } }),
    ev(5, "stage.start", { stage: "backend", attempt: 2 }),
    // A gap is reported, not an error.
    ev(6, "gap", { stage: "qa", detail: "E7 not checked" }),
    ev(7, "human.input", { stage: "qa", text: "ok" }),
  ])
  assert.equal(tr.totals.errors, 2)
  assert.equal(tr.totals.waits, 1)
  assert.deepEqual(tr.markers.map((m) => m.kind), ["wait", "stop", "error", "gap", "human"])
})

test("a gap is never compressed while a session is open", () => {
  const tr = buildTrace([
    ev(0, "stage.start", { stage: "b" }),
    ev(1, "progress", { stage: "b", tool: "session", detail: "s1" }),
    ev(301, "session", { stage: "b", sessionId: "s1", agent: "coder" }),
    ev(302, "stage.end", { stage: "b", ok: true }),
  ])
  assert.deepEqual(tr.breaks, [])
  assert.equal(tr.endT, 302000)
  const sess = tr.spans[0].children[0]
  assert.deepEqual([sess.t0, sess.t1, sess.realMs], [1000, 301000, 300000])
})

test("a break after an owner stop is waiting on you; others are idle", () => {
  const tr = buildTrace([
    ev(0, "stage.start", { stage: "a" }),
    ev(1, "stop", { stage: "a", rule: "human" }),
    ev(2, "run.end", { status: "stopped", rule: "human" }),
    ev(600, "human.input", { stage: "a", text: "go" }),
    ev(601, "run.resume"),
    ev(602, "stage.start", { stage: "b" }),
    ev(603, "stage.end", { stage: "b", ok: true }),
    ev(1200, "run.end", { status: "done" }),
  ])
  assert.deepEqual(tr.breaks.map((b) => [b.reason, b.realMs]), [["waiting", 598000], ["idle", 597000]])
})

test("a stage cut by a stop closes at the stop, and a restart closes the open run", () => {
  // The SIGINT shape: hooks starts, the run is interrupted, hooks starts again later.
  const tr = buildTrace([
    ev(0, "stage.start", { stage: "hooks" }),
    ev(2, "stop", { stage: "hooks", rule: "interrupted" }),
    ev(5, "stage.start", { stage: "hooks" }),
    ev(9, "stage.end", { stage: "hooks", ok: true }),
  ])
  const [first, second] = tr.spans
  assert.deepEqual([first.t0, first.t1, first.realMs, first.running], [0, 2000, 2000, false])
  assert.deepEqual([second.t0, second.t1, second.running], [5000, 9000, false])
  // A stage started twice with no end between: the first closes when the second starts.
  const re = buildTrace([ev(0, "stage.start", { stage: "b" }), ev(3, "stage.start", { stage: "b", attempt: 2 })])
  assert.deepEqual(re.spans.map((s) => [s.t0, s.t1, s.running]), [[0, 3000, false], [3000, 3000, true]])
  // run.end closes open stages and sessions too.
  const end = buildTrace([
    ev(0, "stage.start", { stage: "b" }),
    ev(1, "progress", { stage: "b", tool: "session", detail: "s" }),
    ev(4, "run.end", { status: "stopped", rule: "interrupted" }),
    ev(8, "published"),
  ])
  const all = flat(end.spans)
  assert.equal(all.filter((s) => s.running).length, 0)
  assert.deepEqual(all.map((s) => [s.kind, s.t1]), [["stage", 4000], ["session", 4000]])
})

test("a session end with no id doesn't claim a start marker from an earlier attempt", () => {
  const tr = buildTrace([
    ev(0, "stage.start", { stage: "b", attempt: 1 }),
    ev(1, "progress", { stage: "b", tool: "session", detail: "old" }),
    ev(3, "stage.end", { stage: "b", ok: false }),
    ev(4, "stage.start", { stage: "b", attempt: 2 }),
    ev(8, "session", { stage: "b", agent: "coder" }),
    ev(9, "stage.end", { stage: "b", ok: true }),
  ])
  const [a1, a2] = tr.spans
  assert.deepEqual(a1.children.map((c) => [c.kind, c.t0, c.t1]), [["session", 1000, 3000]])
  assert.deepEqual(a2.children.map((c) => [c.name, c.t0, c.t1]), [["coder", 4000, 8000]])
})

test("t0ts is the first event's time after sorting", () => {
  assert.equal(buildTrace([ev(5, "note"), ev(2, "run.start")]).t0ts, ts(2))
  assert.equal(buildTrace([]).t0ts, null)
})


test("status: stop(human), run.end(human), then trailing preview events is waiting", () => {
  const evs = [
    ev(0, "run.start", { idea: "x" }),
    ev(1, "stage.start", { stage: "frontend", attempt: 1 }),
    ev(2, "stop", { rule: "human", stage: "frontend", detail: "no changes" }),
    ev(3, "run.end", { status: "stopped", rule: "human", stage: "frontend" }),
    ...[4, 5, 6].map((s) => ev(s, "preview", { stage: "frontend", png: "app/preview.png", v: s })),
    ev(7, "design.frames", { directions: [] }),
  ]
  assert.equal(buildTrace(evs).status, "waiting")
})

test("status: a non-human stop is stopped; a resume or new stage.start clears the stop", () => {
  const stop = (rule) => ev(2, "stop", { rule, stage: "a", detail: "d" })
  assert.equal(buildTrace([ev(0, "run.start"), stop("budget"), ev(3, "run.end", { status: "stopped" })]).status, "stopped")
  assert.equal(buildTrace([ev(0, "run.start"), stop("human"), ev(3, "run.resume")]).status, "live")
  assert.equal(buildTrace([ev(0, "run.start"), stop("human"), ev(3, "stage.start", { stage: "a", attempt: 2 })]).status, "live")
  assert.equal(buildTrace([ev(0, "run.start"), stop("human"), ev(3, "run.resume"), ev(4, "run.end", { status: "done" }), ev(5, "published")]).status, "done")
})

test("status: a cursor between an owner stop and run.end is waiting, not live", () => {
  const evs = [
    ev(0, "run.start"), ev(1, "stage.start", { stage: "a", attempt: 1 }),
    ev(2, "stop", { rule: "human", stage: "a", detail: "d" }),
    ev(3, "progress", { stage: "a", tool: "Read", detail: "x" }),
    ev(4, "run.end", { status: "stopped", rule: "human", stage: "a" }),
  ]
  for (let n = 3; n <= 5; n++) assert.equal(buildTrace(evs.slice(0, n)).status, "waiting", `n=${n}`)
})


