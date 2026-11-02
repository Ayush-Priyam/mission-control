// The item map as positioned nodes and links: a run's crew graph (its own or derived), or a session's
// spawn tree (main -> subagents, nested by parent). Node status comes from the item's lanes.
import type { ItemDetail, Lane, Status } from "@/lib/api"
import { CANVAS, nodeOf, type CrewGraph, type Hop } from "@/lib/graph"
import { byActivity, nodeStatus, runGraph } from "@/lib/item"

/** `w` is the node's own width when it is sized to its label (`fullLabels`); else the map's shared width applies. */
export type MapNode = { id: string; label: string; x: number; y: number; status: Status; lanes: string[]; sub?: string; w?: number }
export type MapArc = { from: MapNode; to: MapNode; kind: Hop["kind"]; labels: string[]; n: number }
/** The owner as a node: amber "waiting" edges from lanes that need them, faint "answered" ones from lanes they answered. */
export type YouNode = MapNode & { edges: { from: string; kind: "waiting" | "answered" }[] }
/** Nodes that worked at the same moment. */
export type Band = { nodes: string[]; live: boolean }
export type ItemMapModel = {
  mode: "graph" | "tree"
  w: number
  h: number
  nodes: MapNode[]
  flow: [string, string][]
  consult: [string, string][]
  arcs: MapArc[]
  you?: YouNode
  bands?: Band[]
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
  let level = [...roots.filter((l) => l.kind === "main"), ...roots.filter((l) => l.kind !== "main").sort(byActivity)]
  let y = TREE.top
  const seen = new Set<string>()
  while (level.length) {
    // Within each parent's brood: working/waiting first, then the most recent (parents keep their order).
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
    level = fresh.flatMap((l) => [...(kids.get(l.id) ?? [])].sort(byActivity))
  }
  return { mode: "tree", w: TREE.w, h: y - TREE.row + TREE.top, nodes, flow, consult: [], arcs: [] }
}

// ---- geometry shared by the map and the lanes flow strip ----

export const NODE_H = 54
export type Box = { x: number; y: number; w: number; h: number }
type Pt = { x: number; y: number }
/** A hop chip; `leader` (the arc's midpoint) is set when no clear spot was near it and it moved outside the graph. */
export type Chip = Box & { leader?: Pt }

/** Width that keeps neighbours on the same row apart. */
export function nodeWidth(nodes: MapNode[], max: number, h = NODE_H) {
  let gap = Infinity
  for (const a of nodes) for (const b of nodes) if (a !== b && Math.abs(a.y - b.y) < h) gap = Math.min(gap, Math.abs(a.x - b.x))
  return Math.max(70, Math.min(max, gap - 16))
}

export const nodeBox = (n: Pt, w: number, h = NODE_H): Box => ({ x: n.x - w / 2, y: n.y - h / 2, w, h })
/** A node's width: its own when sized to its label, else the shared one. */
export const widthOf = (n: Pt & { w?: number }, w: number) => n.w ?? w
/** Two boxes overlap (with `pad` px of air between them counted as overlap). */
export const hits = (a: Box, b: Box, pad = 3) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad

/** A hop arc: send-backs bow over the nodes, questions under them. */
export function hopGeom(arc: MapArc, w: number, h = NODE_H) {
  const up = arc.kind === "sendback" ? -1 : 1
  const a = { x: arc.from.x, y: arc.from.y + (up * h) / 2 }
  const b = { x: arc.to.x, y: arc.to.y + (up * h) / 2 }
  const lift = (h / NODE_H) * (40 + Math.min(120, Math.abs(b.x - a.x) * 0.18))
  const c = { x: (a.x + b.x) / 2, y: (up < 0 ? Math.min(a.y, b.y) : Math.max(a.y, b.y)) + up * lift }
  const nudge = Math.min(w / 4, 18) * Math.sign(b.x - a.x || 1)
  const p0 = { x: a.x + nudge, y: a.y }
  const p2 = { x: b.x - nudge, y: b.y + up * 4 }
  const at = (t: number) => ({ x: (1 - t) ** 2 * p0.x + 2 * t * (1 - t) * c.x + t * t * p2.x, y: (1 - t) ** 2 * p0.y + 2 * t * (1 - t) * c.y + t * t * p2.y })
  return { up, d: `M${p0.x},${p0.y} Q${c.x},${c.y} ${p2.x},${p2.y}`, mid: at(0.5), at }
}

export const labelText = (arc: MapArc) =>
  arc.kind === "sendback" ? `↩ ${arc.labels.length ? arc.labels.join(", ") : "sent back"}${arc.n > 1 && !arc.labels.length ? ` ×${arc.n}` : ""}` : `? ${arc.labels.length ? arc.labels.join(", ") : "asked"}${arc.n > 1 && !arc.labels.length ? ` ×${arc.n}` : ""}`

const LABEL_H = 20
const labelW = (text: string) => Math.ceil(text.length * 7.4 + 14)

/**
 * A chip per arc at its midpoint, nudged to the nearest spot that clears every node box, band caption and
 * earlier chip. When nothing near is clear, the chip goes outside the graph (above it for a send-back, below
 * for a question) with a leader line back to its arc, so it never covers a node.
 */
export function labelBoxes(m: ItemMapModel, w: number): Chip[] {
  const nodes = [...m.nodes, ...(m.you ? [m.you] : [])].map((n) => nodeBox(n, widthOf(n, w)))
  const blocked: Box[] = [...nodes]
  // a band's "parallel · N" caption sits above it
  for (const b of bandBoxes(m, w)) if (b.first) blocked.push(bandCaption(b))
  const out: Chip[] = []
  const steps: Pt[] = []
  for (let dy = 0; dy <= 12; dy++) for (let dx = 0; dx <= 8; dx++) for (const sy of dy ? [-1, 1] : [1]) for (const sx of dx ? [-1, 1] : [1]) steps.push({ x: sx * dx * 34, y: sy * dy * 14 })
  steps.sort((p, q) => Math.hypot(p.x, p.y * 1.6) - Math.hypot(q.x, q.y * 1.6))
  const top = Math.min(...nodes.map((b) => b.y)), bottom = Math.max(...nodes.map((b) => b.y + b.h))
  const free = (box: Box) => ![...blocked, ...out].some((b) => hits(box, b))
  for (const arc of m.arcs) {
    const { mid, up } = hopGeom(arc, w)
    const bw = labelW(labelText(arc))
    let pick: Chip | null = null
    for (const s of steps) {
      // prefer moving away from the nodes (outward, along the arc's bow) when equally near
      const box = { x: mid.x - bw / 2 + s.x, y: mid.y - LABEL_H / 2 + s.y * (up < 0 ? 1 : -1), w: bw, h: LABEL_H }
      if (free(box)) { pick = box; break }
    }
    if (!pick) {
      // outside the graph's node bounds, one lane of chips further out each time that lane is taken
      for (let k = 0; !pick; k++) {
        const y = up < 0 ? top - 14 - LABEL_H - k * (LABEL_H + 6) : bottom + 14 + k * (LABEL_H + 6)
        const box = { x: mid.x - bw / 2, y, w: bw, h: LABEL_H }
        if (free(box)) pick = { ...box, leader: { x: mid.x, y: mid.y } }
      }
    }
    out.push(pick)
  }
  return out
}

/** The box that holds everything drawn (nodes, you, arcs, chips, bands), padded, at least `minW` wide. */
export function boundsOf(m: ItemMapModel, w: number, o: { pad?: number; minW?: number; h?: number } = {}): Box {
  const pad = o.pad ?? 18, minW = o.minW ?? 760, h = o.h ?? NODE_H
  const boxes: Box[] = [...m.nodes, ...(m.you ? [m.you] : [])].map((n) => nodeBox(n, widthOf(n, w), h))
  if (h === NODE_H) boxes.push(...labelBoxes(m, w))
  for (const arc of m.arcs) {
    const g = hopGeom(arc, w, h)
    for (let t = 0; t <= 1; t += 0.125) boxes.push({ ...g.at(t), w: 0, h: 0 })
  }
  for (const b of bandBoxes(m, w, h)) boxes.push({ ...b, y: b.y - 16, h: b.h + 16 })
  if (!boxes.length) return { x: 0, y: 0, w: minW, h: 3 * h }
  let x0 = Math.min(...boxes.map((b) => b.x)) - pad, x1 = Math.max(...boxes.map((b) => b.x + b.w)) + pad
  const y0 = Math.min(...boxes.map((b) => b.y)) - pad, y1 = Math.max(...boxes.map((b) => b.y + b.h)) + pad
  if (x1 - x0 < minW) {
    const grow = (minW - (x1 - x0)) / 2
    x0 -= grow
    x1 += grow
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Where a band's caption is drawn (text baseline at y - 6, 11px mono). */
export const bandCaption = (b: Box & { band: Band }): Box => ({ x: b.x + 8, y: b.y - 19, w: 20 + `parallel · ${b.band.nodes.length}`.length * 6.8, h: 17 })

/**
 * One mark per band, with one caption: a box around all its nodes when that box holds no other node, else a
 * bracket over them (a line above the band's nodes with a tick down to each member), so a band never
 * claims a node that was not part of it. When the bracket's line or a tick would cross a non-member (members
 * on different rows with another node between), each member gets its own pad, the caption on the first.
 * The returned box is the box, the bracket's line strip, or a pad.
 */
export type BandMark = Box & { band: Band; first: boolean; bracket?: { y: number; ticks: Pt[] } }
export function bandBoxes(m: ItemMapModel, w: number, h = NODE_H): BandMark[] {
  const at = new Map(m.nodes.map((n) => [n.id, n]))
  const p = h / 4
  const around = (ns: MapNode[]): Box => {
    const x0 = Math.min(...ns.map((n) => n.x - widthOf(n, w) / 2)) - p, x1 = Math.max(...ns.map((n) => n.x + widthOf(n, w) / 2)) + p
    const y0 = Math.min(...ns.map((n) => n.y)) - h / 2 - p, y1 = Math.max(...ns.map((n) => n.y)) + h / 2 + p
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
  }
  return (m.bands ?? []).flatMap((band) => {
    const ns = band.nodes.map((id) => at.get(id)).filter((n): n is MapNode => !!n)
    if (ns.length < 2) return []
    const all = around(ns)
    const others = m.nodes.filter((n) => !ns.includes(n)).map((n) => nodeBox(n, widthOf(n, w), h))
    if (!others.some((o) => hits(all, o, -2))) return [{ ...all, band, first: true }]
    const y = all.y + p / 2 // just above the highest member
    const ticks = ns.map((n) => ({ x: n.x, y: n.y - h / 2 - 2 }))
    // The line and every tick as thin boxes: if any crosses a node outside the band, a bracket would
    // seem to claim it, so each member gets its own pad instead (the caption on the first).
    const line: Box = { x: all.x + p, y: y - 1, w: all.w - 2 * p, h: 2 }
    const legs: Box[] = ticks.map((t) => ({ x: t.x - 1, y, w: 2, h: Math.max(0, t.y - y) }))
    if ([line, ...legs].some((seg) => others.some((o) => hits(seg, o, -1)))) {
      return ns.map((n, i) => {
        const b = nodeBox(n, widthOf(n, w) + 2 * p, h + 2 * p)
        return { ...b, band, first: i === 0 }
      })
    }
    return [{ x: all.x + p, y: y - 4, w: all.w - 2 * p, h: 8, band, first: true, bracket: { y, ticks } }]
  })
}

// ---- what the map adds on top of the graph or tree ----

type Ev = Record<string, any>
const ms = (ts: unknown) => {
  const t = typeof ts === "string" ? Date.parse(ts) : NaN
  return Number.isFinite(t) ? t : null
}
const BUSY = new Set<Status>(["working", "waiting"])

/**
 * Lanes that were working at the same moment: a run's stage spans (stage.start to stage.end, skip or
 * stop; a stage still open runs to `now` while its lane is busy on a live run), a session's lane spans
 * (startedAt to endedAt; a working lane runs to `now`; main, which spans its sub-agents, is left out).
 * Maximal sets of two or more, oldest first.
 */
export function parallelGroups(d: ItemDetail, now = Date.now()): string[][] {
  const lanes = d.lanes ?? []
  const byId = new Map(lanes.map((l) => [l.id, l]))
  const spans: { id: string; s: number; e: number }[] = []
  const events: Ev[] = Array.isArray(d.events) ? d.events : []
  if (events.some((e) => e?.type === "stage.start")) {
    const open = new Map<string, number>()
    for (const e of events) {
      const t = ms(e?.ts)
      if (typeof e?.stage !== "string" || t === null) continue
      if (e.type === "stage.start") {
        const was = open.get(e.stage)
        if (was !== undefined) spans.push({ id: e.stage, s: was, e: t })
        open.set(e.stage, t)
      } else if (e.type === "stage.end" || e.type === "stage.skipped" || e.type === "stop") {
        const s = open.get(e.stage)
        if (s !== undefined) spans.push({ id: e.stage, s, e: t })
        open.delete(e.stage)
      }
    }
    for (const [id, s] of open) if (d.summary.live && BUSY.has(byId.get(id)?.status as Status)) spans.push({ id, s, e: Math.max(now, s + 1) })
  } else {
    // main runs under all of its sub-agents; only the sub-agents say what ran side by side
    for (const l of lanes) {
      if (l.kind === "main") continue
      const s = ms(l.startedAt)
      if (s === null) continue
      const e = l.status === "working" && d.summary.live !== false ? Math.max(now, s + 1) : ms(l.endedAt) ?? ms(l.nowDoing?.ts) ?? s
      if (e > s) spans.push({ id: l.id, s, e })
    }
  }
  const sets: string[][] = []
  for (const at of [...new Set(spans.map((x) => x.s))].sort((a, b) => a - b)) {
    const here = [...new Set(spans.filter((x) => x.s <= at && at < x.e).sort((a, b) => a.s - b.s).map((x) => x.id))]
    if (here.length >= 2) sets.push(here)
  }
  const sub = (a: string[], b: string[]) => a.length <= b.length && a.every((x) => b.includes(x))
  return sets.filter((a, i) => !sets.some((b, j) => j !== i && sub(a, b) && (a.length < b.length || j < i)))
}

/** Send-backs and questions between lanes, one per (from, to, kind), with the ids they carried. */
export type LaneLink = { from: string; to: string; kind: Hop["kind"]; labels: string[] }
export function laneLinks(d: ItemDetail): LaneLink[] {
  const g = runGraph(d)
  if (!g) return []
  const ids = new Set((d.lanes ?? []).map((l) => l.id))
  const laneOf = (stage: string) => (ids.has(stage) ? stage : nodeOf(g, stage)?.stages.find((s) => ids.has(s)) ?? null)
  const out = new Map<string, LaneLink>()
  for (const h of g.hops) {
    const from = laneOf(h.from), to = laneOf(h.to)
    if (!from || !to || from === to) continue
    const k = `${from}>${to}>${h.kind}`
    const link = out.get(k) ?? { from, to, kind: h.kind, labels: [] }
    if (h.label && !link.labels.includes(h.label)) link.labels.push(h.label)
    out.set(k, link)
  }
  return [...out.values()]
}

export const YOU = "you"

/** Add the owner node when a lane waits on them or the run had owner input; a tree moves down a row to make room. */
function withYou(m: ItemMapModel, d: ItemDetail): ItemMapModel {
  const events: Ev[] = Array.isArray(d.events) ? d.events : []
  const g = m.mode === "graph" ? runGraph(d) : null
  const edges: YouNode["edges"] = []
  for (const n of m.nodes) if (n.status === "waiting") edges.push({ from: n.id, kind: "waiting" })
  const inputs = events.filter((e) => e?.type === "human.input")
  for (const e of inputs) {
    const node = typeof e.stage === "string" ? (g ? nodeOf(g, e.stage)?.id : e.stage) : null
    if (node && m.nodes.some((n) => n.id === node) && !edges.some((x) => x.from === node)) edges.push({ from: node, kind: "answered" })
  }
  if (!edges.length && !inputs.length) return m
  const status: Status = edges.some((e) => e.kind === "waiting") ? "waiting" : "idle"
  if (m.mode === "tree") {
    const nodes = m.nodes.map((n) => ({ ...n, y: n.y + TREE.row }))
    return { ...m, nodes, h: m.h + TREE.row, you: { id: YOU, label: "you", x: TREE.w / 2, y: TREE.top, status, lanes: [], edges } }
  }
  const xs = m.nodes.map((n) => n.x)
  const top = Math.min(...m.nodes.map((n) => n.y))
  return { ...m, you: { id: YOU, label: "you", x: (Math.min(...xs) + Math.max(...xs)) / 2, y: top - 130, status, lanes: [], edges } }
}

/** Parallel groups as node bands: the live group first, then the most recent; at most two. */
function bands(m: ItemMapModel, d: ItemDetail, now: number): Band[] {
  const nodeOfLane = (id: string) => m.nodes.find((n) => n.lanes.includes(id) || n.id === id)?.id
  const seen = new Set<string>()
  const out: Band[] = []
  for (const group of parallelGroups(d, now).reverse()) {
    const nodes = [...new Set(group.map(nodeOfLane).filter((x): x is string => !!x))]
    const key = [...nodes].sort().join("|")
    if (nodes.length < 2 || seen.has(key)) continue
    seen.add(key)
    const live = nodes.some((id) => BUSY.has(m.nodes.find((n) => n.id === id)!.status))
    out.push({ nodes, live })
  }
  out.sort((a, b) => Number(b.live) - Number(a.live))
  return out.slice(0, 2)
}

/** Text metrics for a node's two lines: the 15px semibold label and the 12px mono status word. */
export const FULL = { labelChar: 9, wordChar: 7.4, wordMax: 16, inset: 24, end: 16, gap: 28, min: 120 }

/** The width a node needs to show its whole label (and its status word) with no truncation. */
export const fullWidth = (label: string) => Math.max(FULL.min, Math.ceil(FULL.inset + FULL.end + Math.max(label.length * FULL.labelChar, FULL.wordMax * FULL.wordChar)))

/**
 * Size every node to its label and spread the layout sideways (one factor for the whole map, so columns stay
 * columns) until neighbours on a row clear each other by `FULL.gap`. Rows never move.
 */
export function withFullLabels(m: ItemMapModel): ItemMapModel {
  if (!m.nodes.length) return m
  const nodes = m.nodes.map((n) => ({ ...n, w: fullWidth(n.label) }))
  const all = [...nodes, ...(m.you ? [{ ...m.you, w: fullWidth(m.you.label) }] : [])]
  let s = 1
  for (const a of all) for (const b of all) {
    if (a === b || Math.abs(a.y - b.y) >= NODE_H || a.x > b.x) continue
    const need = (a.w + b.w) / 2 + FULL.gap
    const dx = b.x - a.x
    s = Math.max(s, dx > 0 ? need / dx : 1)
  }
  const xs = all.map((n) => n.x)
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const spread = <T extends { x: number }>(n: T): T => ({ ...n, x: cx + (n.x - cx) * s })
  const out = nodes.map(spread)
  const byId = new Map(out.map((n) => [n.id, n]))
  return {
    ...m,
    w: m.w * s,
    nodes: out,
    arcs: m.arcs.map((a) => ({ ...a, from: byId.get(a.from.id) ?? a.from, to: byId.get(a.to.id) ?? a.to })),
    ...(m.you ? { you: spread({ ...m.you, w: fullWidth(m.you.label) }) } : {}),
  }
}

/**
 * The model for an item: its run graph when it has one, else its lanes as a spawn tree; plus you and parallel
 * bands. `fullLabels` sizes each node to its whole label (the full-screen map).
 */
export function mapModel(d: ItemDetail, now = Date.now(), o: { fullLabels?: boolean } = {}): ItemMapModel {
  const g = runGraph(d)
  const base = g ? graphModel(g, d.lanes ?? []) : treeModel(d.lanes ?? [])
  if (!base.nodes.length) return base
  const m = withYou(base, d)
  const banded = { ...m, bands: bands(m, d, now) }
  return o.fullLabels ? withFullLabels(banded) : banded
}
