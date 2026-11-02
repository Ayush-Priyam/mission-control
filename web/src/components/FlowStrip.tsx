import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ItemDetail, Lane, Status } from "@/lib/api"
import { byActivity, modelName } from "@/lib/item"
import { statusLabel } from "@/lib/status-ui"
import { ChartTip, tipAt } from "@/components/ChartTip"
import { ExpandButton, GraphOverlay } from "@/components/GraphOverlay"
import { boundsOf, hopGeom, mapModel, type ItemMapModel, type MapNode } from "@/lib/map"
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

/** About how wide a node must be to show `label` at 12px, dot and padding included. */
export const labelWidth = (label: string) => Math.ceil(label.length * 7.1 + 32)
const MAX_W = 220
const MIN_W = 90

/** The x-gap between the closest neighbours on one row (Infinity: one node per row). */
function rowGap(nodes: MapNode[]) {
  let gap = Infinity
  for (const a of nodes) for (const b of nodes) if (a !== b && Math.abs(a.y - b.y) < H) gap = Math.min(gap, Math.abs(a.x - b.x))
  return gap
}

/** Spread a model's x positions by `f` (nodes, you, arcs). */
function spread(m: ItemMapModel, f: number): ItemMapModel {
  if (f <= 1) return m
  const nodes = m.nodes.map((n) => ({ ...n, x: n.x * f }))
  const at = new Map(nodes.map((n) => [n.id, n]))
  return { ...m, nodes, you: m.you && { ...m.you, x: m.you.x * f }, arcs: m.arcs.map((a) => ({ ...a, from: at.get(a.from.id)!, to: at.get(a.to.id)! })) }
}

/**
 * The strip's layout: every lane (`all`) or a session's busiest few; nodes as wide as their labels need,
 * up to `max` px, the graph spread sideways to make room (the strip scrolls rather than shrinks).
 */
export function flowLayout(detail: ItemDetail, now: number | undefined, all: boolean, max = MAX_W) {
  const t = detail.summary.kind === "session" && !all ? trim(detail.lanes ?? []) : { lanes: detail.lanes ?? [], hidden: 0 }
  let m = squash(mapModel({ ...detail, lanes: t.lanes }, now))
  const want = Math.min(max, Math.max(MIN_W, ...m.nodes.map((n) => labelWidth(n.label))))
  const gap = rowGap(m.nodes)
  if (Number.isFinite(gap) && gap < want + 16) m = spread(m, (want + 16) / gap)
  const w = Math.min(want, Number.isFinite(rowGap(m.nodes)) ? rowGap(m.nodes) - 16 : want)
  return { m, w, hidden: t.hidden, box: boundsOf(m, w, { h: H, pad: 10, minW: 0 }) }
}

const EXPAND_KEY = (tab: string) => `mission-control-flow-expanded:${tab}`
function readExpanded(tab: string) {
  try {
    return localStorage.getItem(EXPAND_KEY(tab)) === "expanded"
  } catch {
    return false
  }
}
function writeExpanded(tab: string, on: boolean) {
  try {
    localStorage.setItem(EXPAND_KEY(tab), on ? "expanded" : "collapsed")
  } catch {}
}

type GraphProps = {
  m: ItemMapModel
  w: number
  box: { x: number; y: number; w: number; h: number }
  hl: string | null
  pick: (n: MapNode) => void
  onYou?: () => void
  /** Draw at exactly 1:1 (full screen); otherwise fill the width, never below 1:1. */
  natural?: boolean
  maxHeight?: number
  onTip?: (n: MapNode | null, el: Element | null) => void
}

function FlowGraph({ m, w, box, hl, pick, onYou, natural, maxHeight, onTip }: GraphProps) {
  const tree = m.mode === "tree"
  const at = new Map(m.nodes.map((n) => [n.id, n]))
  const chars = Math.max(4, Math.floor((w - 26) / 7.1))
  const touches = (a: string, b: string) => hl !== null && (a === hl || b === hl)
  const style = natural
    ? { width: box.w, height: box.h }
    : { width: "100%", minWidth: box.w, maxWidth: box.w * 1.3, ...(maxHeight ? { maxHeight: Math.max(maxHeight, box.h) } : {}) }
  return (
    <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} preserveAspectRatio="xMidYMid meet" style={style} className={cn("block", !natural && "mx-auto h-auto")} role="group" aria-label="Flow strip">
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
        <g role="button" tabIndex={0} data-flow-node="you" aria-label="You: show the needs-you card" className="cursor-pointer" onClick={() => onYou?.()} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onYou?.())}>
          <rect x={m.you.x - 36} y={m.you.y - H / 2} width={72} height={H} rx={7} strokeWidth={m.you.status === "waiting" ? 1.5 : 1} className={m.you.status === "waiting" ? "fill-needs-you/10 stroke-needs-you" : "fill-card stroke-border"} />
          <text x={m.you.x} y={m.you.y + 4} textAnchor="middle" className="fill-foreground text-[12px] font-semibold">you</text>
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
          aria-label={`${n.label} (${statusLabel(n.status)}): show its card`}
          className="cursor-pointer [&:focus-visible>rect.box]:stroke-ring [&:hover>rect.box]:stroke-ring"
          onClick={() => pick(n)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              pick(n)
            }
          }}
          onMouseEnter={(e) => onTip?.(n, e.currentTarget)}
          onMouseLeave={() => onTip?.(null, null)}
          onFocus={(e) => onTip?.(n, e.currentTarget)}
          onBlur={() => onTip?.(null, null)}
        >
          {n.status === "working" && <rect x={n.x - w / 2} y={n.y - H / 2} width={w} height={H} rx={7} fill="none" className="mc-halo stroke-running" />}
          <rect className={cn("box fill-card", n.id === hl ? "stroke-ring" : STROKE[n.status])} x={n.x - w / 2} y={n.y - H / 2} width={w} height={H} rx={7} strokeWidth={n.id === hl ? 2.2 : n.status === "idle" || n.status === "done" ? 1 : 1.5} strokeDasharray={n.status === "stopped" ? "3 2" : undefined} />
          <circle cx={n.x - w / 2 + 10} cy={n.y} r={3} className={DOT[n.status]} />
          <text x={n.x - w / 2 + 18} y={n.y + 4} className={cn("text-[12px] font-medium", n.status === "idle" || n.status === "done" ? "fill-muted-foreground" : "fill-foreground")}>
            {n.label.length > chars ? `${n.label.slice(0, chars - 1)}…` : n.label}
          </text>
        </g>
      ))}
    </svg>
  )
}

/**
 * The Lanes tab's flow strip. Collapsed it shows a session's busiest lanes and a "+N more" button that
 * expands it in place (every lane, scrolling inside 70vh); the choice is remembered per tab. Expand
 * opens the graph full screen with pan and zoom and full labels. Nodes are as wide as their labels (up
 * to 220px); hover or focus shows the full label, status and model. The strip scrolls, never shrinks below 1:1.
 * `highlight` (a lane id, from hovering its card) lights that lane's node and every link and arc touching it.
 */
export function FlowStrip({ detail, now, onPick, onYou, highlight, tab = "lanes" }: { detail: ItemDetail; now?: number; onPick: (laneIds: string[]) => void; onYou?: () => void; highlight?: string | null; tab?: string }) {
  const [expanded, setExpanded] = useState(() => readExpanded(tab))
  const [full, setFull] = useState(false)
  const [tip, setTip] = useState<{ n: MapNode; at: { x: number; y: number } | null } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const strip = useMemo(() => flowLayout(detail, now, expanded), [detail, now, expanded])
  const whole = useMemo(() => (full ? flowLayout(detail, now, true, 480) : null), [detail, now, full])
  const models = useMemo(() => new Map((detail.lanes ?? []).map((l) => [l.id, l.model])), [detail])
  // A strip wider than its panel scrolls; start it on what is happening (needs you, then working).
  const focusId = strip.m.nodes.find((n) => n.status === "waiting")?.id ?? strip.m.nodes.find((n) => n.status === "working")?.id ?? null
  useEffect(() => {
    const el = box.current
    if (!el || !focusId || el.scrollWidth <= el.clientWidth) return
    const n = [...el.querySelectorAll<SVGGElement>("[data-flow-node]")].find((g) => g.getAttribute("data-flow-node") === focusId)
    if (!n) return
    const a = n.getBoundingClientRect(), b = el.getBoundingClientRect()
    el.scrollLeft += a.left - b.left - (el.clientWidth - a.width) / 2
  }, [focusId, strip.box.w])
  // Narrow panels (≤1024 or so) clip the strip: fade the edge that has more beyond it, so it reads as scrollable.
  const [edges, setEdges] = useState({ left: false, right: false })
  const measure = useCallback(() => {
    const el = box.current
    if (!el) return
    const left = el.scrollLeft > 1, right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }))
  }, [])
  useEffect(() => {
    measure()
    const el = box.current
    if (!el || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure, strip.box.w])
  if (!strip.m.nodes.length) return null
  const hl = nodeOfLane(strip.m.nodes, highlight)?.id ?? null
  const pick = (n: MapNode) => onPick(n.lanes.length ? n.lanes : [n.id])
  const toggle = (on: boolean) => {
    setExpanded(on)
    writeExpanded(tab, on)
  }
  const tipText = (n: MapNode) => {
    const ms = [...new Set((n.lanes.length ? n.lanes : [n.id]).map((id) => models.get(id)).filter(Boolean).map((x) => modelName(x!)))]
    return [n.label, statusLabel(n.status), ...ms].join(" · ")
  }

  return (
    <div className="relative rounded-xl border bg-card/40" aria-label="Flow">
      <div className="flex h-9 items-center gap-2 border-b px-3">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          flow · {strip.m.nodes.length}
          {strip.hidden > 0 ? ` of ${strip.m.nodes.length + strip.hidden}` : ""} {strip.m.nodes.length === 1 ? "node" : "nodes"}
        </span>
        {strip.hidden > 0 && (
          <button type="button" onClick={() => toggle(true)} aria-expanded="false" className="h-7 rounded-md border bg-card px-2 font-mono text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
            +{strip.hidden} more · show all
          </button>
        )}
        {expanded && detail.summary.kind === "session" && (detail.lanes?.length ?? 0) > MAX_SUB + 1 && (
          <button type="button" onClick={() => toggle(false)} aria-expanded="true" className="h-7 rounded-md border bg-card px-2 font-mono text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
            Collapse
          </button>
        )}
        <ExpandButton onClick={() => setFull(true)} />
      </div>
      <div className="relative">
        <div ref={box} onScroll={measure} className={cn("relative overflow-x-auto px-2 py-1.5", expanded && "max-h-[70vh] overflow-y-auto")}>
          <FlowGraph
            m={strip.m}
            w={strip.w}
            box={strip.box}
            hl={hl}
            pick={pick}
            onYou={onYou}
            maxHeight={expanded ? undefined : 190}
            onTip={(n, el) => setTip(n && el ? { n, at: tipAt(el as HTMLElement, box.current) } : null)}
          />
          {tip && <ChartTip at={tip.at}>{tipText(tip.n)}</ChartTip>}
        </div>
        {edges.left && <div aria-hidden data-fade="left" className="pointer-events-none absolute inset-y-0 left-0 w-10 rounded-bl-xl bg-linear-to-r from-card to-transparent" />}
        {edges.right && (
          <div aria-hidden data-fade="right" className="pointer-events-none absolute inset-y-0 right-0 flex w-14 items-center justify-end rounded-br-xl bg-linear-to-l from-card to-transparent pr-1.5 font-mono text-xs text-muted-foreground">
            →
          </div>
        )}
      </div>
      {full && whole && (
        <GraphOverlay title={`Flow · ${detail.summary.title || detail.summary.id} · ${(detail.lanes ?? []).length} lanes`} onClose={() => setFull(false)}>
          <div className="p-4">
            <FlowGraph
              m={whole.m}
              w={whole.w}
              box={whole.box}
              hl={hl}
              natural
              pick={(n) => {
                setFull(false)
                pick(n)
              }}
              onYou={
                onYou &&
                (() => {
                  setFull(false)
                  onYou()
                })
              }
            />
          </div>
        </GraphOverlay>
      )}
    </div>
  )
}
