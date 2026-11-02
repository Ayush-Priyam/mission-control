import { useMemo } from "react"
import type { ItemDetail, Status } from "@/lib/api"
import { STATUS_LABEL } from "@/components/StatusDot"
import { runGraph, type LaneExtra } from "@/lib/item"
import { graphModel, treeModel, type ItemMapModel, type MapArc, type MapNode } from "@/lib/map"
import { cn } from "@/lib/utils"

const NODE_H = 54
type Pt = { x: number; y: number }

/** Flow links: an S-curve between node centres (vertical for stacked nodes). */
function curve(a: Pt, b: Pt, vertical = false) {
  const dx = b.x - a.x
  if (vertical || Math.abs(dx) < 20) {
    const my = (a.y + b.y) / 2
    return `M${a.x},${a.y} C${a.x},${my} ${b.x},${my} ${b.x},${b.y}`
  }
  return `M${a.x},${a.y} C${a.x + dx / 2},${a.y} ${b.x - dx / 2},${b.y} ${b.x},${b.y}`
}

/** Width that keeps neighbours on the same row apart. */
function nodeWidth(nodes: MapNode[], max: number) {
  let gap = Infinity
  for (const a of nodes) for (const b of nodes) if (a !== b && Math.abs(a.y - b.y) < NODE_H) gap = Math.min(gap, Math.abs(a.x - b.x))
  return Math.max(70, Math.min(max, gap - 16))
}

const STROKE: Record<Status, string> = {
  working: "stroke-running",
  waiting: "stroke-needs-you",
  failed: "stroke-failed",
  stopped: "stroke-stopped",
  done: "stroke-foreground/30",
  idle: "stroke-border",
}
const FILL: Record<Status, string> = {
  working: "fill-running",
  waiting: "fill-needs-you",
  failed: "fill-failed",
  stopped: "fill-stopped",
  done: "fill-done",
  idle: "fill-faint/50",
}
const WORD_FILL: Record<Status, string> = {
  working: "fill-running",
  waiting: "fill-needs-you",
  failed: "fill-failed",
  stopped: "fill-stopped",
  done: "fill-muted-foreground",
  idle: "fill-faint",
}

function HopArc({ arc, w }: { arc: MapArc; w: number }) {
  // Send-backs arc over the nodes, questions under them, so the two never overlap.
  const up = arc.kind === "sendback" ? -1 : 1
  const a = { x: arc.from.x, y: arc.from.y + (up * NODE_H) / 2 }
  const b = { x: arc.to.x, y: arc.to.y + (up * NODE_H) / 2 }
  const lift = 40 + Math.min(120, Math.abs(b.x - a.x) * 0.18)
  const c = { x: (a.x + b.x) / 2, y: (up < 0 ? Math.min(a.y, b.y) : Math.max(a.y, b.y)) + up * lift }
  const nudge = Math.min(w / 4, 18) * Math.sign(b.x - a.x || 1)
  const d = `M${a.x + nudge},${a.y} Q${c.x},${c.y} ${b.x - nudge},${b.y + up * 4}`
  const mid = { x: 0.25 * a.x + 0.5 * c.x + 0.25 * b.x, y: 0.25 * a.y + 0.5 * c.y + 0.25 * b.y }
  const text = arc.labels.length ? arc.labels.join(", ") : arc.kind === "sendback" ? `sent back${arc.n > 1 ? ` ×${arc.n}` : ""}` : `asked${arc.n > 1 ? ` ×${arc.n}` : ""}`
  const bad = arc.kind === "sendback"
  return (
    <g data-arc={arc.kind}>
      <path d={d} fill="none" strokeWidth={1.6} className={bad ? "stroke-failed" : "stroke-consult"} markerEnd={`url(#map-arrow-${bad ? "failed" : "consult"})`} />
      <text x={mid.x} y={mid.y + (up < 0 ? -6 : 14)} textAnchor="middle" className={cn("font-mono text-[13px]", bad ? "fill-failed" : "fill-consult")}>
        {text}
      </text>
    </g>
  )
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

function Node({ n, w, word, selected, onOpen }: { n: MapNode; w: number; word: string; selected: boolean; onOpen: (n: MapNode) => void }) {
  const chars = Math.max(6, Math.floor((w - 32) / 8.6))
  return (
    <g
      role="button"
      tabIndex={0}
      data-node={n.id}
      data-status={n.status}
      aria-label={`${n.label}: ${word}. Show its log and calls.`}
      className="cursor-pointer outline-none [&:focus-visible>rect.box]:stroke-ring"
      onClick={() => onOpen(n)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onOpen(n)
        }
      }}
    >
      {n.status === "working" && (
        <rect x={n.x - w / 2} y={n.y - NODE_H / 2} width={w} height={NODE_H} rx={10} fill="none" className="mc-halo stroke-running" />
      )}
      {n.status === "waiting" && (
        <rect x={n.x - w / 2 - 3} y={n.y - NODE_H / 2 - 3} width={w + 6} height={NODE_H + 6} rx={12} fill="none" strokeWidth={3} className="stroke-needs-you/25" />
      )}
      <rect
        className={cn("box fill-card", STROKE[n.status], selected && "stroke-ring")}
        x={n.x - w / 2}
        y={n.y - NODE_H / 2}
        width={w}
        height={NODE_H}
        rx={10}
        strokeWidth={n.status === "idle" || n.status === "done" ? 1 : 1.75}
        strokeDasharray={n.status === "stopped" ? "4 3" : undefined}
      />
      <circle cx={n.x - w / 2 + 13} cy={n.y - 7} r={4} className={FILL[n.status]} />
      <text x={n.x - w / 2 + 24} y={n.y - 2} className={cn("text-[15px] font-semibold", n.status === "idle" ? "fill-muted-foreground" : "fill-foreground")}>
        {clip(n.label, chars)}
      </text>
      <text x={n.x - w / 2 + 24} y={n.y + 16} className={cn("font-mono text-[12px]", WORD_FILL[n.status])}>
        {word}
      </text>
      <title>{n.label}</title>
    </g>
  )
}

/** The model for an item: its run graph when it has one, else its lanes as a spawn tree. */
export function mapModel(detail: ItemDetail): ItemMapModel {
  const g = runGraph(detail)
  return g ? graphModel(g, detail.lanes ?? []) : treeModel(detail.lanes ?? [])
}

/**
 * The Map tab. Runs: the crew graph with flow, consult links, red "sent back" and blue "asked" arcs.
 * Sessions: main -> subagents as a tree. Nodes are lit by status; click one for its lane sheet.
 */
export function ItemMap({ detail, extras, selected, onOpen }: { detail: ItemDetail; extras: Map<string, LaneExtra>; selected?: string | null; onOpen: (laneIds: string[]) => void }) {
  const m = useMemo(() => mapModel(detail), [detail])
  if (!m.nodes.length) return <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nothing to map: this item has no lanes.</p>
  const byId = new Map(m.nodes.map((n) => [n.id, n]))
  const w = m.mode === "tree" ? nodeWidth(m.nodes, 158) : nodeWidth(m.nodes, 150)
  const ys = m.nodes.map((n) => n.y)
  const xs = m.nodes.map((n) => n.x)
  // Crop a graph to its nodes (never under 760 wide); a tree keeps the full width so a few nodes stay node-sized.
  const span = m.mode === "graph" ? [Math.max(0, Math.min(...xs) - w / 2 - 24), Math.min(m.w, Math.max(...xs) + w / 2 + 24)] : [0, m.w]
  const grow = Math.max(0, 760 - (span[1] - span[0])) / 2
  const left = span[0] - grow
  const right = span[1] + grow
  const pad = m.mode === "graph" ? 100 : 30
  const top = Math.max(0, Math.min(...ys) - NODE_H / 2 - pad)
  const bottom = Math.min(m.h + pad, Math.max(...ys) + NODE_H / 2 + pad)
  const word = (n: MapNode) => {
    if (n.lanes.length && n.lanes.every((id) => extras.get(id)?.skipped)) return "skipped"
    const r = Math.max(0, ...n.lanes.map((id) => extras.get(id)?.rounds ?? 0))
    return `${STATUS_LABEL[n.status]}${r > 1 ? ` · r${r}` : ""}`
  }
  const link = ([p, q]: [string, string]) => {
    const a = byId.get(p), b = byId.get(q)
    if (!a || !b) return null
    return m.mode === "tree" ? curve({ x: a.x, y: a.y + NODE_H / 2 }, { x: b.x, y: b.y - NODE_H / 2 }, true) : curve(a, b)
  }
  const open = (n: MapNode) => onOpen(n.lanes.length ? n.lanes : [n.id])

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-xl border bg-card/40 p-2">
        <svg viewBox={`${left} ${top} ${right - left} ${Math.max(bottom - top, NODE_H * 3)}`} className="h-auto w-full min-w-[640px] overflow-visible" role="group" aria-label={m.mode === "tree" ? "Session tree" : "Crew map"}>
          <defs>
            {(["failed", "consult"] as const).map((t) => (
              <marker key={t} id={`map-arrow-${t}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" className={t === "failed" ? "fill-failed" : "fill-consult"} />
              </marker>
            ))}
          </defs>
          {m.flow.map((f, i) => {
            const d = link(f)
            const from = byId.get(f[0])
            const lit = from?.status === "done" || from?.status === "working" || from?.status === "waiting"
            return d && <path key={`f${i}`} d={d} fill="none" strokeWidth={1.25} className={lit ? "stroke-foreground/35" : "stroke-foreground/12"} />
          })}
          {m.consult.map((f, i) => {
            const d = link(f)
            return d && <path key={`c${i}`} d={d} fill="none" strokeWidth={1} strokeDasharray="2 5" className="stroke-foreground/25" />
          })}
          {m.arcs.map((a, i) => (
            <HopArc key={`h${i}`} arc={a} w={w} />
          ))}
          {m.nodes.map((n) => (
            <Node key={n.id} n={n} w={w} word={word(n)} selected={!!selected && n.lanes.includes(selected)} onOpen={open} />
          ))}
        </svg>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
        <span><i className="mr-1 inline-block size-2 rounded-full bg-running align-middle" />working</span>
        <span><i className="mr-1 inline-block size-2 rounded-full bg-needs-you align-middle" />needs you</span>
        <span><i className="mr-1 inline-block size-2 rounded-full bg-failed align-middle" />failed</span>
        <span><i className="mr-1 inline-block size-2 rounded-full bg-stopped align-middle" />stopped</span>
        {m.mode === "graph" ? (
          <>
            <span><i className="mr-1 inline-block h-px w-5 bg-foreground/40 align-middle" />work flows</span>
            <span><i className="mr-1 inline-block h-px w-5 border-t border-dashed border-foreground/40 align-middle" />may consult</span>
            <span className="text-failed">↩ sent back</span>
            <span className="text-consult">? asked</span>
            <span>click a stage for its log</span>
          </>
        ) : (
          <span>main → subagents · click a lane for its calls</span>
        )}
      </div>
    </div>
  )
}
