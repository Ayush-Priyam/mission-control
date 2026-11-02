// The item map as positioned nodes and links: a run's crew graph (its own or derived), or a session's
// spawn tree (main -> subagents, nested by parent). Node status comes from the item's lanes.
import type { Lane, Status } from "@/lib/api"
import { CANVAS, nodeOf, type CrewGraph, type Hop } from "@/lib/graph"
import { nodeStatus } from "@/lib/item"

export type MapNode = { id: string; label: string; x: number; y: number; status: Status; lanes: string[]; sub?: string }
export type MapArc = { from: MapNode; to: MapNode; kind: Hop["kind"]; labels: string[]; n: number }
export type ItemMapModel = {
  mode: "graph" | "tree"
  w: number
  h: number
  nodes: MapNode[]
  flow: [string, string][]
  consult: [string, string][]
  arcs: MapArc[]
}

/** A run's crew graph, each node lit by the lanes of its stages. */
export function graphModel(g: CrewGraph, lanes: Lane[]): ItemMapModel {
  const byId = new Map(lanes.map((l) => [l.id, l]))
  const nodes: MapNode[] = g.nodes.map((n) => {
    const mine = n.stages.map((s) => byId.get(s)).filter((l): l is Lane => !!l)
    if (!mine.length && byId.has(n.id)) mine.push(byId.get(n.id)!)
    return { id: n.id, label: n.label, x: n.x, y: n.y, status: nodeStatus(mine.map((l) => l.status)), lanes: mine.map((l) => l.id) }
  })
  const at = new Map(nodes.map((n) => [n.id, n]))
  const arcs = new Map<string, MapArc>()
  for (const h of g.hops) {
    const a = nodeOf(g, h.from), b = nodeOf(g, h.to)
    const from = a && at.get(a.id), to = b && at.get(b.id)
    if (!from || !to || from === to) continue
    const k = `${from.id}>${to.id}>${h.kind}`
    const arc = arcs.get(k) ?? { from, to, kind: h.kind, labels: [], n: 0 }
    arc.n++
    if (h.label && !arc.labels.includes(h.label)) arc.labels.push(h.label)
    arcs.set(k, arc)
  }
  return { mode: "graph", w: CANVAS.w, h: CANVAS.h, nodes, flow: g.flow, consult: g.consult, arcs: [...arcs.values()] }
}

export const TREE = { w: 820, cols: 5, top: 46, row: 88, step: 168 }

/** A session's lanes as a spawn tree: main on top, each generation below in rows of up to `cols`. */
export function treeModel(lanes: Lane[], cols = TREE.cols): ItemMapModel {
  const ids = new Set(lanes.map((l) => l.id))
  const roots = lanes.filter((l) => !l.parent || !ids.has(l.parent) || l.parent === l.id)
  const kids = new Map<string, Lane[]>()
  for (const l of lanes) if (!roots.includes(l)) kids.set(l.parent!, [...(kids.get(l.parent!) ?? []), l])
  const nodes: MapNode[] = []
  const flow: [string, string][] = []
  let level = roots
  let y = TREE.top
  const seen = new Set<string>()
  while (level.length) {
    const fresh = level.filter((l) => !seen.has(l.id))
    fresh.forEach((l) => seen.add(l.id))
    for (let r = 0; r * cols < fresh.length; r++) {
      const row = fresh.slice(r * cols, r * cols + cols)
      const step = Math.min(TREE.w / row.length, TREE.step)
      const x0 = (TREE.w - step * row.length) / 2
      row.forEach((l, i) => {
        nodes.push({ id: l.id, label: l.label, x: x0 + step * (i + 0.5), y, status: l.status, lanes: [l.id], ...(l.model ? { sub: l.model } : {}) })
        if (l.parent && ids.has(l.parent) && l.parent !== l.id) flow.push([l.parent, l.id])
      })
      y += TREE.row
    }
    level = fresh.flatMap((l) => kids.get(l.id) ?? [])
  }
  return { mode: "tree", w: TREE.w, h: y - TREE.row + TREE.top, nodes, flow, consult: [], arcs: [] }
}
