import { describe, expect, it } from "vitest"
import type { ItemDetail, Lane, Status } from "./api"
import { actionNote } from "./api"
import { cacheShare, estCost, findings, health, laneExtras, laneTree, nodeStatus, span, summarize } from "./item"

const tok = (n = 0) => ({ in: n, out: 0, cacheRead: 0, cacheWrite: 0 })
const lane = (id: string, status: Status, o: Partial<Lane> = {}): Lane => ({ id, label: id, kind: "stage", status, calls: 0, errors: 0, tokens: tok(), cost: 0, ...o })
const item = (o: Omit<Partial<ItemDetail>, "summary"> & { summary?: Partial<ItemDetail["summary"]> } = {}): ItemDetail => ({
  lanes: [],
  events: [],
  ...o,
  summary: {
    source: "native", id: "r1", kind: "run", title: "t", harness: "h", cwd: null, branch: null, live: false, status: "idle", waiting: false,
    startedAt: null, updatedAt: null, counts: { lanes: 0, calls: 0, errors: 0 }, tokens: tok(), cost: 0, ...o.summary,
  },
})

describe("nodeStatus", () => {
  it("a non-owner stop stays stopped, never failed", () => {
    expect(nodeStatus(["stopped", "done"])).toBe("stopped")
    expect(nodeStatus(["stopped"])).toBe("stopped")
  })
  it("needs-you beats working beats failed beats stopped", () => {
    expect(nodeStatus(["working", "waiting"])).toBe("waiting")
    expect(nodeStatus(["failed", "working"])).toBe("working")
    expect(nodeStatus(["stopped", "failed"])).toBe("failed")
  })
  it("all done is done; nothing or idle is idle", () => {
    expect(nodeStatus(["done", "done"])).toBe("done")
    expect(nodeStatus(["done", "idle"])).toBe("done")
    expect(nodeStatus([])).toBe("idle")
    expect(nodeStatus(["idle"])).toBe("idle")
  })
})

describe("laneTree", () => {
  it("nests subagents under their parent, main first, busy children first", () => {
    const lanes = [
      lane("a1", "done", { kind: "subagent", parent: "main", startedAt: "2026-01-01T10:00:00Z" }),
      lane("main", "working", { kind: "main" }),
      lane("a2", "working", { kind: "subagent", parent: "main" }),
      lane("orphan", "idle", { kind: "subagent", parent: "gone" }),
    ]
    const g = laneTree(lanes)
    expect(g.map((x) => x.lane.id)).toEqual(["main", "orphan"])
    expect(g[0].children.map((c) => c.id)).toEqual(["a2", "a1"])
  })
})

describe("summarize", () => {
  it("counts running lanes, subagents, cache share, duration and short models", () => {
    const d = item({
      summary: { startedAt: "2026-01-01T10:00:00Z", updatedAt: "2026-01-01T10:42:00Z", tokens: { in: 10, out: 5, cacheRead: 90, cacheWrite: 0 }, counts: { lanes: 3, calls: 7, errors: 1 }, cost: 0.84 },
      lanes: [lane("main", "working", { kind: "main", model: "claude-opus-4-1" }), lane("a", "working", { kind: "subagent", parent: "main", model: "claude-sonnet-4-5" }), lane("b", "done", { kind: "subagent", parent: "main", model: "claude-sonnet-4-5" })],
    })
    const s = summarize(d)
    expect(s.running).toBe(2)
    expect(s.lanes).toMatchObject({ total: 3, main: 1, subagents: 2 })
    expect(s.cache).toBeCloseTo(0.9)
    expect(span(s.durationMs)).toBe("42m")
    expect(s.models).toEqual(["opus", "sonnet"])
    expect(s.calls).toBe(7)
  })
  it("a live item runs to now; an empty item has no duration or cache", () => {
    const d = item({ summary: { live: true, startedAt: "2026-01-01T10:00:00Z", updatedAt: "2026-01-01T10:01:00Z" } })
    expect(summarize(d, Date.parse("2026-01-01T13:05:00Z")).durationMs).toBe((3 * 60 + 5) * 60000)
    const e = summarize(item())
    expect(e.durationMs).toBeNull()
    expect(e.cache).toBeNull()
    expect(cacheShare(tok())).toBeNull()
  })
})

describe("costs say est.", () => {
  it("formats every cost as an estimate", () => {
    expect(estCost(0.84)).toBe("$0.84 est.")
    expect(estCost(0.004)).toBe("<$0.01 est.")
    expect(estCost(0)).toBe("–")
  })
})

// A run: qa sent work back to backend, backend asked architect Q4, then a budget stop on frontend.
const run = item({
  state: { stages: { backend: { status: "running", rounds: 3 }, architect: { status: "running" }, qa: { status: "done", rounds: 2 }, frontend: { status: "stopped" } } },
  lanes: [lane("backend", "working"), lane("architect", "working"), lane("qa", "done"), lane("frontend", "stopped", { reason: "3 rounds (limit 3)" })],
  events: [
    { type: "stage.start", stage: "qa", ts: "2026-01-01T10:00:00Z" },
    { type: "stage.end", stage: "qa", ok: true, ts: "2026-01-01T10:05:00Z" },
    { type: "issue", stage: "qa", summary: "X3 negative bill returns 500", decision: { owner: "backend", blocks: true }, ts: "2026-01-01T10:05:00Z" },
    { type: "consult.asked", id: "Q4", from: "backend", to: "architect", question: "400 or 422?", ts: "2026-01-01T10:06:00Z" },
    { type: "stop", stage: "frontend", rule: "budget", detail: "3 rounds (limit 3)", ts: "2026-01-01T10:07:00Z" },
  ],
  summary: { counts: { lanes: 4, calls: 10, errors: 1 } },
})

describe("laneExtras", () => {
  it("send-back, question and budget stop chips; rounds from the state", () => {
    const x = laneExtras(run)
    expect(x.get("backend")).toMatchObject({ rounds: 3, chip: { kind: "sendback", text: "fix · from qa" } })
    expect(x.get("architect")?.chip).toEqual({ kind: "consult", text: "answering Q4 · backend" })
    expect(x.get("frontend")?.chip).toEqual({ kind: "stopped", text: "3 rounds (limit 3)" })
    expect(x.get("qa")?.chip).toBeNull()
  })
})

describe("health and findings", () => {
  it("a run's errors come from its issues; send-backs, questions and extra rounds from its events and state", () => {
    const h = health(run, [])
    expect(h).toMatchObject({ errors: 1, calls: 10, sendBacks: 1, consults: 1, rework: 3 })
    expect(h.okRate).toBeCloseTo(0.9)
    const f = findings(run)
    expect(f.map((x) => x.tone)).toEqual(["failed", "consult"])
    expect(f[0].text).toContain("sent back to backend")
    expect(f[1].text).toContain("Q4")
  })
  it("a session's errors are its failed calls", () => {
    const s = item({ summary: { kind: "session", counts: { lanes: 1, calls: 2, errors: 1 } }, lanes: [lane("main", "idle", { kind: "main" })] })
    const calls = [
      { id: "c1", lane: "main", ts: "", name: "Bash", kind: "tool" as const, summary: "npm test", ok: false, error: "Exit code 1" },
      { id: "c2", lane: "main", ts: "", name: "Read", kind: "tool" as const, summary: "a", ok: true },
    ]
    expect(health(s, calls)).toMatchObject({ errors: 1, calls: 2, okRate: 0.5 })
    expect(findings(s, calls)).toEqual([{ tone: "failed", text: "Bash: Exit code 1", lane: "main", ts: "" }])
  })
  it("an empty item has no findings and no ok rate", () => {
    expect(findings(item())).toEqual([])
    expect(health(item(), []).okRate).toBeNull()
  })
})

describe("actionNote (v1 fix: a resume that did not start is an error)", () => {
  it("resumed:false reads as an error with the reason", () => {
    expect(actionNote("Signed", { ok: true, resumed: false, error: "ronin not found" })).toEqual({ ok: false, text: "Signed, but the run could not resume: ronin not found" })
    expect(actionNote("Signed", { resumed: true })).toEqual({ ok: true, text: "Signed." })
    expect(actionNote("Sent to qa", {})).toEqual({ ok: true, text: "Sent to qa." })
  })
})
