import { useMemo } from "react"
import type { ItemDetail, Lane, Status } from "@/lib/api"
import { byActivity } from "@/lib/item"
import { boundsOf, hopGeom, mapModel, nodeWidth, type ItemMapModel, type MapNode } from "@/lib/map"
import { cn } from "@/lib/utils"

// The Lanes tab's flow strip: the item map drawn small (same model), live. A node scrolls to its card.

const H = 28
const SQUASH = 0.5
/** A session shows its main lanes and this many of its busiest sub-agents; the rest are counted. */
const MAX_SUB = 12

const STROKE: Record<Status, string> = {
  working: "stroke-running",
  waiting: "stroke-needs-you",
  failed: "stroke-failed",
  stopped: "stroke-stopped",
  done: "stroke-foreground/30",
  idle: "stroke-border",
}
const DOT: Record<Status, string> = {
  working: "fill-running",
  waiting: "fill-needs-you",
  failed: "fill-failed",
  stopped: "fill-stopped",
  done: "fill-done",
  idle: "fill-faint/50",
}

/** A session's busiest lanes (roots always), so the strip stays a strip. */
function trim(lanes: Lane[]): { lanes: Lane[]; hidden: number } {
  const ids = new Set(lanes.map((l) => l.id))
  const roots = lanes.filter((l) => !l.parent || !ids.has(l.parent) || l.parent === l.id)
  const rest = lanes.filter((l) => !roots.includes(l))
  if (rest.length <= MAX_SUB) return { lanes, hidden: 0 }
  const keep = new Set([...rest].sort(byActivity).slice(0, MAX_SUB))
  return { lanes: lanes.filter((l) => roots.includes(l) || keep.has(l)), hidden: rest.length - MAX_SUB }
}

const squash = (m: ItemMapModel): ItemMapModel => {
  const y = (n: MapNode) => ({ ...n, y: n.y * SQUASH })
  const nodes = m.nodes.map(y)
  const at = new Map(nodes.map((n) => [n.id, n]))
  return {
    ...m,
    nodes,
    you: m.you && { ...m.you, y: m.you.y * SQUASH },
    arcs: m.arcs.map((a) => ({ ...a, from: at.get(a.from.id)!, to: at.get(a.to.id)! })),
    bands: [],
  }
}

function link(a: MapNode, b: MapNode, w: number, tree: boolean) {
  if (tree) {
    const p = { x: a.x, y: a.y + H / 2 }, q = { x: b.x, y: b.y - H / 2 - 2 }
    const my = (p.y + q.y) / 2
    return `M${p.x},${p.y} C${p.x},${my} ${q.x},${my} ${q.x},${q.y}`
  }
  const dir = Math.sign(b.x - a.x || 1)
  const p = { x: a.x + (dir * w) / 2, y: a.y }, q = { x: b.x - (dir * w) / 2 - dir * 2, y: b.y }
  const dx = q.x - p.x
  return `M${p.x},${p.y} C${p.x + dx / 2},${p.y} ${q.x - dx / 2},${q.y} ${q.x},${q.y}`
}

/** The strip's node for a lane: the node itself, or the band node that carries it. */
export const nodeOfLane = (nodes: MapNode[], lane: string | null | undefined) => (lane ? nodes.find((n) => n.id === lane || n.lanes.includes(lane)) ?? null : null)

/** `highlight` (a lane id, from hovering its card) lights that lane's node and every link and arc touching it. */
export function FlowStrip({ detail, now, onPick, onYou, highlight }: { detail: ItemDetail; now?: number; onPick: (laneIds: string[]) => void; onYou?: () => void; highlight?: string | null }) {
  const { m, hidden } = useMemo(() => {
    const t = detail.summary.kind === "session" ? trim(detail.lanes ?? []) : { lanes: detail.lanes ?? [], hidden: 0 }
    return { m: squash(mapModel({ ...detail, lanes: t.lanes }, now)), hidden: t.hidden }
  }, [detail, now])
  if (!m.nodes.length) return null
  const tree = m.mode === "tree"
  const w = Math.min(120, nodeWidth(m.nodes, 120, H))
  const box = boundsOf(m, w, { h: H, pad: 10, minW: 0 })
  const at = new Map(m.nodes.map((n) => [n.id, n]))
  const pick = (n: MapNode) => onPick(n.lanes.length ? n.lanes : [n.id])
  const chars = Math.max(4, Math.floor((w - 24) / 6.6))
  const hl = nodeOfLane(m.nodes, highlight)?.id ?? null
  const touches = (a: string, b: string) => hl !== null && (a === hl || b === hl)

  return (
    <div className="relative rounded-xl border bg-card/40 px-2 py-1.5" aria-label="Flow">
      <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} preserveAspectRatio="xMidYMid meet" style={{ maxHeight: 190 }} className="block h-auto w-full" role="group" aria-label="Flow strip">
        <defs>
          {(["flow", "failed", "consult", "needs-you"] as const).map((t) => (
            <marker key={t} id={`flow-arrow-${t}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className={t === "flow" ? "fill-foreground/40" : t === "failed" ? "fill-failed" : t === "consult" ? "fill-consult" : "fill-needs-you"} />
            </marker>
          ))}
        </defs>
        {m.flow.map(([p, q], i) => {
          const a = at.get(p), b = at.get(q)
          if (!a || !b) return null
          const lit = a.status === "done" || a.status === "working" || a.status === "waiting"
          const on = touches(p, q)
          return <path key={`f${i}`} data-flow-link data-hl={on || undefined} d={link(a, b, w, tree)} fill="none" strokeWidth={on ? 2 : 1.1} className={on ? "stroke-ring" : lit ? "stroke-foreground/35" : "stroke-foreground/12"} markerEnd="url(#flow-arrow-flow)" />
        })}
        {m.arcs.map((a, i) => {
          const bad = a.kind === "sendback"
          const on = touches(a.from.id, a.to.id)
          return <path key={`a${i}`} data-flow-arc={a.kind} data-hl={on || undefined} d={hopGeom(a, w, H).d} fill="none" strokeWidth={on ? 2.2 : 1.1} className={bad ? (on ? "stroke-failed" : "stroke-failed/80") : on ? "stroke-consult" : "stroke-consult/80"} markerEnd={`url(#flow-arrow-${bad ? "failed" : "consult"})`} />
        })}
        {m.you?.edges.map((e) => {
          const n = at.get(e.from)
          if (!n || !m.you) return null
          const a = { x: n.x, y: n.y - H / 2 }, b = { x: m.you.x, y: m.you.y + H / 2 + 2 }
          const my = (a.y + b.y) / 2
          const live = e.kind === "waiting"
          return <path key={`y${e.from}`} d={`M${a.x},${a.y} C${a.x},${my} ${b.x},${my} ${b.x},${b.y}`} fill="none" strokeWidth={live ? 1.4 : 1} strokeDasharray={live ? "5 3" : "2 4"} className={live ? "mc-dash stroke-needs-you" : "stroke-foreground/25"} markerEnd={live ? "url(#flow-arrow-needs-you)" : undefined} />
        })}
        {m.you && (
          <g role="button" tabIndex={0} data-flow-node="you" aria-label="You: show the needs-you card" className="cursor-pointer outline-none" onClick={() => onYou?.()} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onYou?.())}>
            <rect x={m.you.x - 36} y={m.you.y - H / 2} width={72} height={H} rx={7} strokeWidth={m.you.status === "waiting" ? 1.5 : 1} className={m.you.status === "waiting" ? "fill-needs-you/10 stroke-needs-you" : "fill-card stroke-border"} />
            <text x={m.you.x} y={m.you.y + 4} textAnchor="middle" className="fill-foreground text-[11px] font-semibold">you</text>
          </g>
        )}
        {m.nodes.map((n) => (
          <g
            key={n.id}
            role="button"
            tabIndex={0}
            data-flow-node={n.id}
            data-status={n.status}
            data-hl={n.id === hl || undefined}
            aria-label={`${n.label}: show its card`}
            className="cursor-pointer outline-none [&:focus-visible>rect.box]:stroke-ring [&:hover>rect.box]:stroke-ring"
            onClick={() => pick(n)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                pick(n)
              }
            }}
          >
            {n.status === "working" && <rect x={n.x - w / 2} y={n.y - H / 2} width={w} height={H} rx={7} fill="none" className="mc-halo stroke-running" />}
            <rect className={cn("box fill-card", n.id === hl ? "stroke-ring" : STROKE[n.status])} x={n.x - w / 2} y={n.y - H / 2} width={w} height={H} rx={7} strokeWidth={n.id === hl ? 2.2 : n.status === "idle" || n.status === "done" ? 1 : 1.5} strokeDasharray={n.status === "stopped" ? "3 2" : undefined} />
            <circle cx={n.x - w / 2 + 10} cy={n.y} r={3} className={DOT[n.status]} />
            <text x={n.x - w / 2 + 18} y={n.y + 4} className={cn("text-[11px] font-medium", n.status === "idle" || n.status === "done" ? "fill-muted-foreground" : "fill-foreground")}>
              {n.label.length > chars ? `${n.label.slice(0, chars - 1)}…` : n.label}
            </text>
            <title>{n.label}</title>
          </g>
        ))}
      </svg>
      {hidden > 0 && <span className="absolute right-3 bottom-1.5 font-mono text-[10.5px] text-faint">+{hidden} more below</span>}
    </div>
  )
}
