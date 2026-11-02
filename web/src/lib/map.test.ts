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
    // the working child leads its generation (activity order)
    expect(m.flow).toEqual([["main", "b"], ["main", "a"], ["a", "c"]])
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

// ---- polish: labels, parallel bands, the "you" node, fit, activity order ----
import type { ItemDetail } from "./api"
import { bandBoxes, bandCaption, boundsOf, hits, labelBoxes, laneLinks, mapModel, NODE_H, nodeBox, nodeWidth, parallelGroups, YOU } from "./map"

const T = (m: number) => new Date(Date.UTC(2026, 0, 1, 10, m)).toISOString()
const DEMO_GRAPH = {
  nodes: {
    prep: { label: "prep", x: 90, y: 280, stages: ["setup", "map"] },
    product: { label: "product", x: 230, y: 280 },
    spec: { label: "spec", x: 370, y: 280 },
    architect: { label: "architect", x: 510, y: 280 },
    design: { label: "design", x: 650, y: 190 },
    frontend: { label: "frontend", x: 790, y: 190 },
    backend: { label: "backend", x: 720, y: 380 },
    qa: { label: "qa", x: 910, y: 280 },
    review: { label: "review", x: 910, y: 420 },
  },
  flow: [["prep", "product"], ["product", "spec"], ["spec", "architect"], ["architect", "design"], ["design", "frontend"], ["architect", "backend"], ["frontend", "qa"], ["backend", "qa"], ["qa", "review"]],
}
const busyEvents = [
  { type: "stage.start", stage: "backend", ts: T(0) },
  { type: "stage.end", stage: "backend", ok: true, ts: T(5) },
  { type: "issue", id: "X3", stage: "qa", decision: { owner: "backend", blocks: true }, ts: T(6) },
  { type: "issue", id: "X5", stage: "qa", decision: { owner: "frontend", blocks: true }, ts: T(6) },
  { type: "stage.start", stage: "backend", ts: T(7) },
  { type: "stage.start", stage: "frontend", ts: T(8) },
  { type: "consult.asked", id: "Q4", from: "backend", to: "architect", ts: T(9) },
  { type: "stage.start", stage: "architect", ts: T(9) },
  { type: "stop", stage: "qa", rule: "human", ts: T(10) },
]
const runDetail = (events: any[], lanes: Lane[], live = true): ItemDetail => ({
  summary: { source: "demo", id: "r1", kind: "run", title: "t", harness: "h", cwd: null, branch: null, live, status: "working", waiting: false, startedAt: T(0), updatedAt: T(10), counts: { lanes: lanes.length, calls: 0, errors: 0 }, tokens: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }, cost: 0 },
  lanes,
  events,
  state: { graph: DEMO_GRAPH },
})
const busyLanes = [
  lane("backend", "working", { kind: "stage" }),
  lane("frontend", "working", { kind: "stage" }),
  lane("architect", "working", { kind: "stage" }),
  lane("qa", "waiting", { kind: "stage" }),
  lane("review", "idle", { kind: "stage" }),
]

describe("hop labels", () => {
  it("every label box clears every node box and every other label (busy demo graph)", () => {
    const m = mapModel(runDetail(busyEvents, busyLanes), Date.parse(T(11)))
    const w = nodeWidth(m.nodes, 150)
    const labels = labelBoxes(m, w)
    expect(labels.length).toBe(m.arcs.length)
    expect(m.arcs.length).toBeGreaterThanOrEqual(3)
    const nodes = [...m.nodes, ...(m.you ? [m.you] : [])].map((n) => nodeBox(n, w))
    for (const b of bandBoxes(m, w)) if (b.first) nodes.push(bandCaption(b))
    expect(m.bands?.length).toBe(1)
    labels.forEach((l, i) => {
      for (const n of nodes) expect(hits(l, n), `label ${i} vs node`).toBe(false)
      labels.forEach((o, j) => j !== i && expect(hits(l, o), `label ${i} vs ${j}`).toBe(false))
    })
  })
})

describe("parallelGroups", () => {
  it("stages open at the same moment form one group; sequential stages do not", () => {
    const g = parallelGroups(runDetail(busyEvents, busyLanes), Date.parse(T(11)))
    expect(g.map((x) => [...x].sort())).toEqual([["architect", "backend", "frontend"]])
  })
  it("a finished run with overlapping stage spans still shows them; a sequential one shows none", () => {
    const ev = [
      { type: "stage.start", stage: "a", ts: T(0) }, { type: "stage.start", stage: "b", ts: T(1) }, { type: "stage.end", stage: "a", ts: T(3) }, { type: "stage.end", stage: "b", ts: T(4) },
      { type: "stage.start", stage: "c", ts: T(5) }, { type: "stage.end", stage: "c", ts: T(6) },
    ]
    expect(parallelGroups(runDetail(ev, [lane("a", "done"), lane("b", "done"), lane("c", "done")], false), 0)).toEqual([["a", "b"]])
    const seq = [{ type: "stage.start", stage: "a", ts: T(0) }, { type: "stage.end", stage: "a", ts: T(1) }, { type: "stage.start", stage: "b", ts: T(2) }, { type: "stage.end", stage: "b", ts: T(3) }]
    expect(parallelGroups(runDetail(seq, [lane("a", "done"), lane("b", "done")], false), 0)).toEqual([])
  })
  it("sessions: sub-agents whose spans overlap; a working one runs to now", () => {
    const d = { ...runDetail([], []), state: undefined, summary: { ...runDetail([], []).summary, kind: "session" as const } }
    d.lanes = [
      lane("main", "working", { kind: "main", startedAt: T(0) }),
      lane("s1", "done", { parent: "main", startedAt: T(1), endedAt: T(4) }),
      lane("s2", "working", { parent: "main", startedAt: T(3) }),
    ]
    // main spans its sub-agents, so it is not "in parallel" with them
    expect(parallelGroups(d, Date.parse(T(9))).map((x) => [...x].sort())).toEqual([["s1", "s2"]])
  })
})

describe("the you node", () => {
  it("appears with an amber waiting edge from the lane that needs the owner", () => {
    const m = mapModel(runDetail(busyEvents, busyLanes), Date.parse(T(11)))
    expect(m.you?.id).toBe(YOU)
    expect(m.you?.edges).toEqual([{ from: "qa", kind: "waiting" }])
    expect(m.you!.y).toBeLessThan(Math.min(...m.nodes.map((n) => n.y)))
  })
  it("appears (no waiting edge) when the run had owner input, absent otherwise", () => {
    const calm = busyLanes.map((l) => ({ ...l, status: "done" as Status }))
    const answered = mapModel(runDetail([...busyEvents.slice(0, 2), { type: "human.input", stage: "qa", text: "ok", ts: T(11) }], calm, false))
    expect(answered.you?.edges).toEqual([{ from: "qa", kind: "answered" }])
    expect(mapModel(runDetail(busyEvents.slice(0, 2), calm, false)).you).toBeUndefined()
  })
  it("a session tree with a waiting lane gets the you node on its own top row", () => {
    const d = { ...runDetail([], []), state: undefined }
    d.lanes = [lane("main", "waiting", { kind: "main" }), lane("s1", "done", { parent: "main" })]
    const m = mapModel(d)
    expect(m.mode).toBe("tree")
    expect(m.you?.edges).toEqual([{ from: "main", kind: "waiting" }])
    expect(m.you!.y).toBeLessThan(m.nodes.find((n) => n.id === "main")!.y)
  })
})

describe("bands", () => {
  it("one box when it holds only its own nodes, else one bracket over them: one mark, one caption, never pads", async () => {
    const { bandBoxes } = await import("./map")
    const n = (id: string, x: number, y: number) => ({ id, label: id, x, y, status: "working" as Status, lanes: [id] })
    const base = { mode: "tree" as const, w: 820, h: 400, flow: [], consult: [], arcs: [] }
    const tight = bandBoxes({ ...base, nodes: [n("a", 100, 50), n("b", 300, 50), n("c", 100, 300)], bands: [{ nodes: ["a", "b"], live: true }] }, 150)
    expect(tight.length).toBe(1)
    const loose = bandBoxes({ ...base, nodes: [n("a", 100, 50), n("x", 300, 50), n("b", 500, 50)], bands: [{ nodes: ["a", "b"], live: true }] }, 150)
    expect(loose.length).toBe(1)
    expect(loose[0].first).toBe(true)
    expect(loose[0].bracket?.ticks.map((t) => t.x)).toEqual([100, 500]) // ticks to members only, none to x
    expect(tight[0].bracket).toBeUndefined()
  })
})

describe("hop label fallback", () => {
  it("with no clear spot near the arc, the chip goes outside the graph with a leader line and covers no node", async () => {
    const { labelBoxes } = await import("./map")
    const n = (id: string, x: number, y: number) => ({ id, label: id, x, y, status: "idle" as Status, lanes: [id] })
    // a dense 13 x 9 grid of nodes: every spot near the arc's midpoint is covered
    const nodes = Array.from({ length: 13 * 9 }, (_, i) => n(`n${i}`, (i % 13) * 60, Math.floor(i / 13) * 60))
    const from = nodes[4 * 13 + 2], to = nodes[4 * 13 + 10]
    const m = { mode: "graph" as const, w: 800, h: 600, flow: [], consult: [], bands: [], nodes, arcs: [{ from, to, kind: "sendback" as const, labels: ["X1"], n: 1 }, { from, to, kind: "question" as const, labels: ["Q1"], n: 1 }] }
    const w = 56
    const chips = labelBoxes(m as any, w)
    const boxes = nodes.map((x) => nodeBox(x, w))
    for (const c of chips) {
      for (const b of boxes) expect(hits(c, b)).toBe(false)
      expect(c.leader).toBeTruthy()
    }
    expect(chips[0].y + chips[0].h).toBeLessThan(Math.min(...boxes.map((b) => b.y))) // send-back: above
    expect(chips[1].y).toBeGreaterThan(Math.max(...boxes.map((b) => b.y + b.h))) // question: below
  })
})

describe("fit", () => {
  it("bounds hug the content: no band taller than a node's height above or below it", () => {
    const m = mapModel(runDetail(busyEvents, busyLanes), Date.parse(T(11)))
    const w = nodeWidth(m.nodes, 150)
    const b = boundsOf(m, w)
    const tops = [...m.nodes, m.you!].map((n) => n.y - NODE_H / 2)
    const bots = m.nodes.map((n) => n.y + NODE_H / 2)
    expect(Math.min(...tops) - b.y).toBeLessThan(NODE_H)
    // send-back and asked arcs may hang below the lowest node, but not by more than their lift + label
    expect(b.y + b.h - Math.max(...bots)).toBeLessThan(200)
    expect(b.w).toBeGreaterThanOrEqual(760)
  })
})

describe("tree order", () => {
  it("each generation runs working/waiting first, then most recent, before it is cut into rows", () => {
    const kids = [
      lane("old", "done", { parent: "main", startedAt: T(1) }),
      lane("new", "done", { parent: "main", startedAt: T(5) }),
      lane("busy", "working", { parent: "main", startedAt: T(0) }),
      lane("ask", "waiting", { parent: "main", startedAt: T(0) }),
    ]
    const m = treeModel([lane("main", "working", { kind: "main" }), ...kids], 2)
    const rows = m.nodes.filter((n) => n.id !== "main")
    expect(rows.map((n) => n.id)).toEqual(["ask", "busy", "new", "old"])
    expect(rows[0].y).toBe(rows[1].y)
    expect(rows[2].y).toBeGreaterThan(rows[0].y)
  })
})

describe("laneLinks", () => {
  it("send-backs and questions between lanes, merged with their ids", () => {
    expect(laneLinks(runDetail(busyEvents, busyLanes))).toEqual([
      { from: "qa", to: "backend", kind: "sendback", labels: ["X3"] },
      { from: "qa", to: "frontend", kind: "sendback", labels: ["X5"] },
      { from: "backend", to: "architect", kind: "consult", labels: ["Q4"] },
    ])
  })
})
