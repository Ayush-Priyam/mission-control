import { describe, expect, it } from "vitest"
import type { Lane, Status } from "./api"
import { crewGraph } from "./graph"
import { graphModel, treeModel, TREE } from "./map"

const lane = (id: string, status: Status, o: Partial<Lane> = {}): Lane => ({ id, label: id, kind: "subagent", status, calls: 0, errors: 0, tokens: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }, cost: 0, ...o })

describe("treeModel (a session as main -> subagents)", () => {
  it("main on top, children one level down, grandchildren below them, linked by spawn", () => {
    const m = treeModel([lane("main", "working", { kind: "main" }), lane("a", "done", { parent: "main" }), lane("b", "working", { parent: "main" }), lane("c", "failed", { parent: "a" })])
    const y = Object.fromEntries(m.nodes.map((n) => [n.id, n.y]))
    expect(m.mode).toBe("tree")
    expect(y.main).toBeLessThan(y.a)
    expect(y.a).toBe(y.b)
    expect(y.c).toBeGreaterThan(y.a)
    expect(m.flow).toEqual([["main", "a"], ["main", "b"], ["a", "c"]])
    expect(m.nodes.find((n) => n.id === "c")?.status).toBe("failed")
  })
  it("wraps a generation into rows of `cols`, centred", () => {
    const kids = Array.from({ length: 7 }, (_, i) => lane(`k${i}`, "done", { parent: "main" }))
    const m = treeModel([lane("main", "idle", { kind: "main" }), ...kids], 5)
    const rows = new Set(m.nodes.filter((n) => n.id !== "main").map((n) => n.y))
    expect(rows.size).toBe(2)
    expect(m.nodes[0].x).toBeCloseTo(TREE.w / 2)
  })
  it("no lanes, no nodes", () => {
    expect(treeModel([]).nodes).toEqual([])
  })
})

describe("graphModel (a run's crew graph)", () => {
  const state = {
    graph: { nodes: { qa: { label: "qa", x: 900, y: 280 }, backend: { label: "backend", x: 700, y: 380 }, prep: { label: "prep", x: 90, y: 280, stages: ["setup", "map"] } }, flow: [["prep", "backend"], ["backend", "qa"]] },
  }
  const events = [
    { type: "issue", stage: "qa", decision: { owner: "backend", blocks: true }, ts: "t1" },
    { type: "issue", stage: "qa", decision: { owner: "backend", blocks: true }, ts: "t2" },
    { type: "consult.asked", id: "Q4", from: "backend", to: "qa", ts: "t3" },
  ]
  it("lights nodes from their lanes: a budget-stopped stage is stopped, not failed", () => {
    const m = graphModel(crewGraph(state, events), [lane("qa", "stopped", { kind: "stage" }), lane("backend", "working", { kind: "stage" }), lane("setup", "done", { kind: "stage" })])
    const st = Object.fromEntries(m.nodes.map((n) => [n.id, n.status]))
    expect(st).toEqual({ qa: "stopped", backend: "working", prep: "done" })
    expect(m.nodes.find((n) => n.id === "prep")?.lanes).toEqual(["setup"])
  })
  it("merges hops into one sent-back arc (×2) and one asked arc", () => {
    const m = graphModel(crewGraph(state, events), [])
    const arcs = m.arcs.map((a) => [a.from.id, a.to.id, a.kind, a.n, a.labels])
    expect(arcs).toEqual([
      ["qa", "backend", "sendback", 2, []],
      ["backend", "qa", "consult", 1, ["Q4"]],
    ])
  })
})
