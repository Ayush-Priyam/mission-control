import { describe, expect, it } from "vitest"
import type { Call, Lane } from "@/lib/api"
import { buildTimeline } from "./timeline"

const tok = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }
const lane = (id: string, o: Partial<Lane> = {}): Lane => ({ id, label: id, kind: id === "main" ? "main" : "subagent", status: "done", calls: 0, errors: 0, tokens: tok, cost: 0, ...o })
const call = (id: string, l: string, ts: string, o: Partial<Call> = {}): Call => ({ id, lane: l, ts, name: "Bash", kind: "tool", summary: id, ...o })
const T = (m: number, s = 0) => `2026-11-02T09:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.000Z`

describe("buildTimeline", () => {
  it("rows main first then sub-agents by start; bars from first/last timestamps; ticks coloured by kind", () => {
    const lanes = [lane("agent-b", { startedAt: T(5) }), lane("agent-a", { startedAt: T(2), endedAt: T(4) }), lane("main", { startedAt: T(0), endedAt: T(10) })]
    const calls = [call("c1", "main", T(1)), call("c2", "agent-a", T(3), { kind: "mcp" }), call("c3", "agent-b", T(6), { ok: false }), call("c4", "agent-b", T(8), { kind: "skill" })]
    const tl = buildTimeline(lanes, calls, { live: false, now: 0 })
    expect(tl.rows.map((r) => r.lane.id)).toEqual(["main", "agent-a", "agent-b"])
    expect([tl.rows[0].a, tl.rows[0].b]).toEqual([0, 1])
    expect(tl.rows[1].a).toBeCloseTo(0.2)
    expect(tl.rows[1].b).toBeCloseTo(0.4)
    // agent-b has no endedAt: its bar ends at its last call
    expect(tl.rows[2].b).toBeCloseTo(0.8)
    expect(tl.rows[2].ticks.map((t) => t.kind)).toEqual(["error", "skill"])
    expect(tl.rows[1].ticks[0].x).toBeCloseTo(0.3)
    expect(tl.playhead).toBeNull()
    expect(tl.breaks).toEqual([])
  })

  it("folds long idle gaps into breaks and puts the playhead at now while live", () => {
    const lanes = [lane("main", { status: "working", startedAt: T(0) })]
    const calls = [call("c1", "main", T(1)), call("c2", "main", "2026-11-02T13:00:00.000Z")]
    const now = Date.parse("2026-11-02T13:01:00.000Z")
    const tl = buildTimeline(lanes, calls, { live: true, now })
    expect(tl.breaks.length).toBe(1)
    expect(tl.breaks[0].realMs).toBe(Date.parse("2026-11-02T13:00:00.000Z") - Date.parse(T(1)))
    expect(tl.playhead).toBe(1)
    expect(tl.rows[0].running).toBe(true)
    expect(tl.rows[0].b).toBe(1)
    // two active minutes plus one break: the second call sits past the hatch, not at 99%
    expect(tl.rows[0].ticks[1].x).toBeLessThan(0.6)
    expect(tl.activeMs).toBe(120_000)
  })

  it("nothing with a timestamp: rows without bars, no axis (empty states, not crashes)", () => {
    expect(buildTimeline([], [], { live: false, now: 0 })).toMatchObject({ rows: [], t0: null, playhead: null })
    const tl = buildTimeline([lane("build", { kind: "stage" })], [], { live: true, now: 5 })
    expect(tl.rows[0]).toMatchObject({ a: null, b: null, ticks: [] })
  })

  it("zoomed in, the axis carries more marks, still apart on the wider track", () => {
    const lanes = [lane("main", { startedAt: T(0), endedAt: T(9) })]
    const calls = Array.from({ length: 40 }, (_, i) => call(`c${i}`, "main", T(Math.floor(i / 5), (i % 5) * 10)))
    const one = buildTimeline(lanes, calls, { live: false, now: 0 })
    const four = buildTimeline(lanes, calls, { live: false, now: 0, zoom: 4 })
    expect(four.marks.length).toBeGreaterThan(one.marks.length * 2)
    for (let i = 1; i < four.marks.length; i++) expect(four.marks[i].x - four.marks[i - 1].x).toBeGreaterThan(0.1 / 4 - 1e-9)
  })
})

