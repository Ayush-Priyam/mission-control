import { useMemo, useState } from "react"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { ScrollArea } from "@/components/ui/scroll-area"
import { StageLog } from "@/components/StageLog"
import { cn } from "@/lib/utils"
import { toHash } from "@/lib/route"
import { stageEvents } from "@/lib/events"
import { CANVAS, nodeOf, type CrewCard, type CrewGraph, type GraphNode } from "@/lib/graph"

type Ev = Record<string, any>
type Pt = { x: number; y: number }

const NODE_H = 46

/** Flow links: the old page's S-curve between node centres. */
function curve(a: Pt, b: Pt) {
  const dx = b.x - a.x
  if (Math.abs(dx) < 20) {
    const my = (a.y + b.y) / 2
    return `M${a.x},${a.y} C${a.x},${my} ${b.x},${my} ${b.x},${b.y}`
  }
  return `M${a.x},${a.y} C${a.x + dx / 2},${a.y} ${b.x - dx / 2},${b.y} ${b.x},${b.y}`
}

/** Width that keeps neighbours on the same row apart. */
function nodeWidth(nodes: GraphNode[]) {
  let gap = Infinity
  for (const a of nodes) for (const b of nodes) if (a !== b && Math.abs(a.y - b.y) < NODE_H) gap = Math.min(gap, Math.abs(a.x - b.x))
  return Math.max(64, Math.min(140, gap - 14))
}

const STROKE: Record<string, string> = {
  running: "stroke-running",
  "needs-you": "stroke-needs-you",
  failed: "stroke-failed",
  done: "stroke-foreground/35",
  skipped: "stroke-border",
  idle: "stroke-border",
}
const WORD: Record<string, string> = { running: "now", "needs-you": "needs you", failed: "failed", done: "done", skipped: "skipped", idle: "idle" }

type Arc = { from: GraphNode; to: GraphNode; kind: "sendback" | "consult"; labels: string[]; n: number }

/** Hops between nodes, merged per direction and kind. */
function arcs(g: CrewGraph): Arc[] {
  const out = new Map<string, Arc>()
  for (const h of g.hops) {
    const from = nodeOf(g, h.from), to = nodeOf(g, h.to)
    if (!from || !to || from === to) continue
    const k = `${from.id}>${to.id}>${h.kind}`
    const a = out.get(k) ?? { from, to, kind: h.kind, labels: [], n: 0 }
    a.n++
    if (h.label) a.labels.push(h.label)
    out.set(k, a)
  }
  return [...out.values()]
}

function HopArc({ arc, w }: { arc: Arc; w: number }) {
  // Send-backs arc over the nodes, questions under them, so the two never overlap.
  const up = arc.kind === "sendback" ? -1 : 1
  const a = { x: arc.from.x, y: arc.from.y + (up * NODE_H) / 2 }
  const b = { x: arc.to.x, y: arc.to.y + (up * NODE_H) / 2 }
  const lift = 40 + Math.min(120, Math.abs(b.x - a.x) * 0.18)
  const c = { x: (a.x + b.x) / 2, y: (up < 0 ? Math.min(a.y, b.y) : Math.max(a.y, b.y)) + up * lift }
  // Start/end a little off the edge so the arrowhead sits clear of the box.
  const nudge = Math.min(w / 4, 18) * Math.sign(b.x - a.x || 1)
  const d = `M${a.x + nudge},${a.y} Q${c.x},${c.y} ${b.x - nudge},${b.y + up * 4}`
  const mid = { x: 0.25 * a.x + 0.5 * c.x + 0.25 * b.x, y: 0.25 * a.y + 0.5 * c.y + 0.25 * b.y }
  const text = arc.labels.length ? arc.labels.join(", ") : arc.n > 1 ? `×${arc.n}` : arc.kind === "sendback" ? "sent back" : "question"
  const tone = arc.kind === "sendback" ? "failed" : "consult"
  return (
    <g>
      <path d={d} fill="none" strokeWidth={1.5} className={tone === "failed" ? "stroke-failed" : "stroke-consult"} markerEnd={`url(#arrow-${tone})`} />
      <text x={mid.x} y={mid.y + (up < 0 ? -6 : 14)} textAnchor="middle" className={cn("font-mono text-[12px]", tone === "failed" ? "fill-failed" : "fill-consult")}>
        {text}
      </text>
    </g>
  )
}

/** The map tab: the crew graph with flow, consult links and the hops that actually happened. Click a node for its log. */
export function CrewMap({ runId, graph, cards, events }: { runId: string; graph: CrewGraph; cards: CrewCard[]; events: Ev[] }) {
  const [open, setOpen] = useState<string | null>(null)
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph])
  const cardOf = useMemo(() => new Map(cards.map((c) => [c.node.id, c])), [cards])
  const w = nodeWidth(graph.nodes)
  const sel = open ? byId.get(open) : undefined
  const selCard = open ? cardOf.get(open) : undefined

  if (!graph.nodes.length) return <p className="font-mono text-sm text-muted-foreground">No stages yet.</p>

  // Crop the canvas to the rows in use, leaving room above and below for hop arcs.
  const ys = graph.nodes.map((n) => n.y)
  const top = Math.max(0, Math.min(...ys) - NODE_H / 2 - 110)
  const bottom = Math.min(CANVAS.h, Math.max(...ys) + NODE_H / 2 + 110)

  const link = ([p, q]: [string, string]) => {
    const a = byId.get(p), b = byId.get(q)
    return a && b ? curve(a, b) : null
  }

  return (
    <div className="flex flex-col gap-2">
      <svg viewBox={`0 ${top} ${CANVAS.w} ${Math.max(bottom - top, NODE_H * 3)}`} className="h-auto w-full overflow-visible" role="group" aria-label="Crew map">
        <defs>
          {(["failed", "consult"] as const).map((t) => (
            <marker key={t} id={`arrow-${t}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className={t === "failed" ? "fill-failed" : "fill-consult"} />
            </marker>
          ))}
        </defs>
        {graph.flow.map((f, i) => {
          const d = link(f)
          const lit = cardOf.get(f[0])?.status === "done"
          return d && <path key={`f${i}`} d={d} fill="none" strokeWidth={1.25} className={lit ? "stroke-foreground/40" : "stroke-foreground/12"} />
        })}
        {graph.consult.map((f, i) => {
          const d = link(f)
          return d && <path key={`c${i}`} d={d} fill="none" strokeWidth={1} strokeDasharray="2 5" className="stroke-foreground/25" />
        })}
        {arcs(graph).map((a, i) => (
          <HopArc key={`h${i}`} arc={a} w={w} />
        ))}
        {graph.nodes.map((n) => {
          const c = cardOf.get(n.id)
          const status = c?.status ?? "idle"
          return (
            <g
              key={n.id}
              role="button"
              tabIndex={0}
              aria-label={`${n.label}: ${WORD[status]}. Show its log.`}
              className="cursor-pointer outline-none [&:focus-visible>rect]:stroke-ring [&:focus-visible>rect]:stroke-[3]"
              onClick={() => setOpen(n.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  setOpen(n.id)
                }
              }}
            >
              <rect
                x={n.x - w / 2}
                y={n.y - NODE_H / 2}
                width={w}
                height={NODE_H}
                rx={8}
                strokeWidth={status === "idle" || status === "skipped" ? 1 : 2}
                className={cn("fill-card", STROKE[status], open === n.id && "stroke-ring")}
              />
              <text x={n.x} y={n.y - 3} textAnchor="middle" className="fill-foreground font-mono text-[14px] font-bold">
                {n.label}
              </text>
              <text x={n.x} y={n.y + 14} textAnchor="middle" className={cn("font-mono text-[11px]", status === "needs-you" ? "fill-needs-you" : status === "running" ? "fill-running" : "fill-muted-foreground")}>
                {WORD[status]}
                {c && c.rounds > 1 ? ` · r${c.rounds}` : ""}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="flex flex-wrap gap-4 font-mono text-[11px] text-muted-foreground">
        <span><i className="mr-1 inline-block h-px w-5 bg-foreground/40 align-middle" />work flows</span>
        <span><i className="mr-1 inline-block h-px w-5 border-t border-dashed border-foreground/40 align-middle" />may consult</span>
        <span className="text-failed">↩ sent back</span>
        <span className="text-consult">? asked</span>
        <span>click a stage for its log</span>
      </div>
      <Sheet open={!!sel} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          {sel && (
            <>
              <SheetHeader>
                <SheetTitle className="font-mono">{sel.label}</SheetTitle>
                <SheetDescription className="font-mono text-xs">
                  {WORD[selCard?.status ?? "idle"]}
                  {selCard && selCard.rounds > 1 ? ` · round ${selCard.rounds}` : ""}
                  {sel.stages.length > 1 || sel.stages[0] !== sel.id ? ` · stages ${sel.stages.join(", ")}` : ""} ·{" "}
                  <a className="underline hover:text-foreground" href={toHash({ view: "agent", id: runId, stage: selCard?.stage ?? sel.id })}>
                    open its console
                  </a>
                </SheetDescription>
              </SheetHeader>
              <ScrollArea className="min-h-0 flex-1 px-4 pb-4">
                <StageLog events={stageEvents(events, sel.stages)} empty="No events for this stage yet." />
              </ScrollArea>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
