import { useMemo } from "react"
import type { ItemDetail, Status } from "@/lib/api"
import { STATUS_LABEL } from "@/components/StatusDot"
import type { LaneExtra } from "@/lib/item"
import { bandBoxes, boundsOf, hopGeom, labelBoxes, labelText, mapModel, NODE_H, nodeWidth, widthOf, type Box, type Chip, type ItemMapModel, type MapArc, type MapNode, type YouNode } from "@/lib/map"
import { cn } from "@/lib/utils"

export { mapModel }
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

const STROKE: Record<Status, string> = {
  working: "stroke-running",
  waiting: "stroke-needs-you",
  looping: "stroke-looping",
  failed: "stroke-failed",
  stopped: "stroke-stopped",
  done: "stroke-foreground/30",
  idle: "stroke-border",
}
const FILL: Record<Status, string> = {
  working: "fill-running",
  waiting: "fill-needs-you",
  looping: "fill-looping",
  failed: "fill-failed",
  stopped: "fill-stopped",
  done: "fill-done",
  idle: "fill-faint/50",
}
const WORD_FILL: Record<Status, string> = {
  working: "fill-running",
  waiting: "fill-needs-you",
  looping: "fill-looping",
  failed: "fill-failed",
  stopped: "fill-stopped",
  done: "fill-muted-foreground",
  idle: "fill-faint",
}

function HopArc({ arc, w, chip }: { arc: MapArc; w: number; chip: Chip }) {
  const { d } = hopGeom(arc, w)
  const bad = arc.kind === "sendback"
  return (
    <g data-arc={arc.kind}>
      <path d={d} fill="none" strokeWidth={1.6} className={bad ? "stroke-failed" : "stroke-consult"} markerEnd={`url(#map-arrow-${bad ? "failed" : "consult"})`} />
      {chip.leader && (
        <path data-leader d={`M${chip.leader.x},${chip.leader.y} L${chip.x + chip.w / 2},${chip.leader.y < chip.y ? chip.y : chip.y + chip.h}`} fill="none" strokeWidth={1} strokeDasharray="2 3" className={bad ? "stroke-failed/50" : "stroke-consult/50"} />
      )}
      <g data-chip>
        <rect x={chip.x} y={chip.y} width={chip.w} height={chip.h} rx={6} className={cn("fill-background", bad ? "stroke-failed/45" : "stroke-consult/45")} strokeWidth={1} />
        <text x={chip.x + chip.w / 2} y={chip.y + chip.h / 2 + 4} textAnchor="middle" className={cn("font-mono text-[12px]", bad ? "fill-failed" : "fill-consult")}>
          {labelText(arc)}
        </text>
      </g>
    </g>
  )
}

/** The owner: amber while something waits on them; edges from each lane that needs (or needed) them. */
function You({ you, at, w, onYou }: { you: YouNode; at: Map<string, MapNode>; w: number; onYou?: () => void }) {
  const waiting = you.status === "waiting"
  return (
    <g>
      {you.edges.map((e) => {
        const n = at.get(e.from)
        if (!n) return null
        const a = { x: n.x, y: n.y - NODE_H / 2 }, b = { x: you.x, y: you.y + NODE_H / 2 + 4 }
        const my = (a.y + b.y) / 2
        const live = e.kind === "waiting"
        return (
          <path
            key={e.from}
            data-you-edge={e.kind}
            d={`M${a.x},${a.y} C${a.x},${my} ${b.x},${my} ${b.x},${b.y}`}
            fill="none"
            strokeWidth={live ? 1.8 : 1}
            strokeDasharray={live ? "6 4" : "2 5"}
            className={live ? "mc-dash stroke-needs-you" : "stroke-foreground/25"}
            markerEnd={live ? "url(#map-arrow-needs-you)" : undefined}
          />
        )
      })}
      <g
        role="button"
        tabIndex={0}
        data-node="you"
        data-status={you.status}
        aria-label={waiting ? "You: something needs you. Show the needs-you card." : "You: your answers in this run"}
        className="cursor-pointer outline-none [&:focus-visible>rect.box]:stroke-ring"
        onClick={() => onYou?.()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            onYou?.()
          }
        }}
      >
        {waiting && <rect x={you.x - w / 2 - 3} y={you.y - NODE_H / 2 - 3} width={w + 6} height={NODE_H + 6} rx={12} fill="none" strokeWidth={3} className="stroke-needs-you/25" />}
        <rect className={cn("box", waiting ? "fill-needs-you/10 stroke-needs-you" : "fill-card stroke-border")} x={you.x - w / 2} y={you.y - NODE_H / 2} width={w} height={NODE_H} rx={10} strokeWidth={waiting ? 1.75 : 1} />
        <text x={you.x} y={you.y - 2} textAnchor="middle" className="fill-foreground text-[15px] font-semibold">you</text>
        <text x={you.x} y={you.y + 16} textAnchor="middle" className={cn("font-mono text-[12px]", waiting ? "fill-needs-you" : "fill-muted-foreground")}>
          {waiting ? `needs you${you.edges.filter((e) => e.kind === "waiting").length > 1 ? ` · ${you.edges.filter((e) => e.kind === "waiting").length}` : ""}` : "answered"}
        </text>
      </g>
    </g>
  )
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

function Node({ n, w, word, selected, onOpen }: { n: MapNode; w: number; word: string; selected: boolean; onOpen: (n: MapNode) => void }) {
  // a node sized to its label (full screen) shows all of it; else clip to the shared width
  const chars = n.w ? Infinity : Math.max(6, Math.floor((w - 32) / 8.6))
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
        {n.w ? word : clip(word, Math.max(6, Math.floor((w - 30) / 7.3)))}
      </text>
      <title>{`${n.label} · ${word}`}</title>
    </g>
  )
}

/**
 * A tree's links as a bus: a trunk down from each parent, one rail above each row of its children,
 * and a short drop to each child. Lit while the child is busy or done, faint while idle.
 */
function TreeBus({ m }: { m: ItemMapModel }) {
  const at = new Map(m.nodes.map((n) => [n.id, n]))
  const kids = new Map<string, MapNode[]>()
  for (const [p, c] of m.flow) {
    const child = at.get(c)
    if (child && at.has(p)) kids.set(p, [...(kids.get(p) ?? []), child])
  }
  const paths: { d: string; lit: boolean }[] = []
  for (const [pid, children] of kids) {
    const p = at.get(pid)!
    const rows = new Map<number, MapNode[]>()
    for (const c of children) rows.set(c.y, [...(rows.get(c.y) ?? []), c])
    const railY = (y: number) => y - NODE_H / 2 - 12
    const last = Math.max(...rows.keys())
    paths.push({ d: `M${p.x},${p.y + NODE_H / 2} V${railY(last)}`, lit: true })
    for (const [y, row] of rows) {
      const xs = row.map((c) => c.x)
      paths.push({ d: `M${Math.min(p.x, ...xs)},${railY(y)} H${Math.max(p.x, ...xs)}`, lit: true })
      for (const c of row) paths.push({ d: `M${c.x},${railY(y)} V${y - NODE_H / 2}`, lit: c.status !== "idle" })
    }
  }
  return (
    <g aria-hidden>
      {paths.map((p, i) => (
        <path key={i} d={p.d} fill="none" strokeWidth={1.2} className={p.lit ? "stroke-foreground/30" : "stroke-foreground/12"} />
      ))}
    </g>
  )
}

/**
 * The Map tab. Runs: the crew graph with flow, consult links, red "sent back" and blue "asked" arcs.
 * Sessions: main -> subagents as a tree. Nodes are lit by status; click one for its lane sheet.
 */
export function ItemMap({
  detail,
  extras,
  selected,
  onOpen,
  onYou,
  natural,
  fullLabels,
}: {
  detail: ItemDetail
  extras: Map<string, LaneExtra>
  selected?: string | null
  onOpen: (laneIds: string[]) => void
  onYou?: () => void
  /** Draw 1:1 at the graph's own size (full screen); no panel height cap. */
  natural?: boolean
  /** Size every node to its whole label, never truncated (full screen). */
  fullLabels?: boolean
}) {
  const m = useMemo(() => mapModel(detail, Date.now(), { fullLabels }), [detail, fullLabels])
  if (!m.nodes.length) return <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nothing to map: this item has no lanes.</p>
  const byId = new Map(m.nodes.map((n) => [n.id, n]))
  const w = m.mode === "tree" ? nodeWidth(m.nodes, 158) : nodeWidth(m.nodes, 150)
  // Crop to what is drawn (never under 760 wide) and let the panel's height cap it, centred.
  const box = boundsOf(m, w)
  const chips = labelBoxes(m, w)
  const bands = bandBoxes(m, w)
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
      <div className={cn("rounded-xl border bg-card/40 p-2", !natural && "max-h-[calc(100vh-17rem)] overflow-auto")}>
        <svg
          viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
          preserveAspectRatio="xMidYMid meet"
          // fit the panel's height, but never shrink a tall tree past legibility (then the panel scrolls)
          style={natural ? { width: box.w, height: box.h } : { maxHeight: `max(calc(100vh - 19rem), ${Math.round(box.h * 0.8)}px)`, minHeight: 240 }}
          className={cn("overflow-visible", !natural && "h-auto w-full min-w-[640px]")}
          role="group"
          aria-label={m.mode === "tree" ? "Session tree" : "Crew map"}
        >
          <defs>
            {(["failed", "consult", "needs-you"] as const).map((t) => (
              <marker key={t} id={`map-arrow-${t}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" className={t === "failed" ? "fill-failed" : t === "consult" ? "fill-consult" : "fill-needs-you"} />
              </marker>
            ))}
          </defs>
          {bands.map((b, i) => (
            <g key={`b${i}`} aria-hidden>
              {b.bracket ? (
                <path
                  data-band-bracket
                  d={`M${b.x},${b.bracket.y + 8} V${b.bracket.y} H${b.x + b.w} V${b.bracket.y + 8} ${b.bracket.ticks.map((t) => `M${t.x},${b.bracket!.y} V${t.y}`).join(" ")}`}
                  fill="none"
                  strokeWidth={1.25}
                  strokeDasharray="3 4"
                  className={b.band.live ? "stroke-running/50" : "stroke-foreground/25"}
                />
              ) : (
                <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={16} strokeDasharray="3 5" className={b.band.live ? "fill-running/[0.05] stroke-running/35" : "fill-foreground/[0.03] stroke-foreground/20"} />
              )}
              {b.first && (
                <text data-band x={b.x + 12} y={b.y - 6} className={cn("font-mono text-[11px] tracking-wide", b.band.live ? "fill-running" : "fill-muted-foreground")}>
                  parallel · {b.band.nodes.length}
                </text>
              )}
            </g>
          ))}
          {m.mode === "tree" && <TreeBus m={m} />}
          {m.mode === "graph" && m.flow.map((f, i) => {
            const d = link(f)
            const from = byId.get(f[0])
            const lit = from?.status === "done" || from?.status === "working" || from?.status === "waiting"
            return d && <path key={`f${i}`} d={d} fill="none" strokeWidth={1.25} className={lit ? "stroke-foreground/35" : "stroke-foreground/12"} />
          })}
          {m.consult.map((f, i) => {
            const d = link(f)
            return d && <path key={`c${i}`} d={d} fill="none" strokeWidth={1} strokeDasharray="2 5" className="stroke-foreground/25" />
          })}
          {m.you && <You you={m.you} at={byId} w={m.you.w ?? Math.min(w, 130)} onYou={onYou} />}
          {m.nodes.map((n) => (
            <Node key={n.id} n={n} w={widthOf(n, w)} word={word(n)} selected={!!selected && n.lanes.includes(selected)} onOpen={open} />
          ))}
          {/* arcs and their chips over the nodes so a chip is never hidden */}
          {m.arcs.map((a, i) => (
            <HopArc key={`h${i}`} arc={a} w={w} chip={chips[i]} />
          ))}
        </svg>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
        <span><i className="mr-1 inline-block size-2 rounded-full bg-running align-middle" />working</span>
        <span><i className="mr-1 inline-block size-2 rounded-full bg-needs-you align-middle" />needs you</span>
        <span><i className="mr-1 inline-block size-2 rounded-full bg-failed align-middle" />failed</span>
        <span><i className="mr-1 inline-block size-2 rounded-full bg-stopped align-middle" />stopped</span>
        {bands.length > 0 && <span><i className="mr-1 inline-block h-2 w-4 rounded-sm border border-dashed border-running/50 align-middle" />worked at the same time</span>}
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
