import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Minus, Plus } from "lucide-react"
import type { Call, Lane } from "@/lib/api"
import { displayName, fmtTime } from "@/components/CallList"
import { StatusDot } from "@/components/StatusDot"
import { dur } from "@/views/Trace"
import { buildTimeline, type TickKind } from "@/lib/timeline"
import { cn } from "@/lib/utils"

// The Timeline tab for an item without v1 events (a Claude Code session, any source's run): a row per lane,
// its session bar, and a tick per call coloured by kind. A tick opens that call on the Calls tab.

export const TICK: Record<TickKind, { label: string; bg: string }> = {
  tool: { label: "tool", bg: "bg-zinc-300" },
  mcp: { label: "mcp", bg: "bg-violet-400" },
  skill: { label: "skill", bg: "bg-amber-400" },
  agent: { label: "agent", bg: "bg-sky-400" },
  error: { label: "error", bg: "bg-failed" },
}
const KINDS: TickKind[] = ["tool", "mcp", "skill", "agent", "error"]
const HATCH = "bg-[repeating-linear-gradient(135deg,color-mix(in_srgb,var(--muted-foreground)_26%,transparent)_0_2px,transparent_2px_5px)]"

type Props = {
  lanes: Lane[]
  calls: Call[]
  live: boolean
  now: number
  /** A tick was clicked. */
  onPick: (call: Call) => void
  /** A lane name was clicked. */
  onOpenLane?: (lane: string) => void
}

const MAX_ZOOM = 32
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(1, Math.round(z * 100) / 100))

/**
 * Zoom for a dense timeline: +/− buttons and ctrl/⌘+wheel. The track grows past the panel and scrolls;
 * a wheel zoom keeps the instant under the pointer where it was.
 */
function useZoom() {
  const [zoom, setZoom] = useState(1)
  const scroller = useRef<HTMLDivElement>(null)
  const anchor = useRef<{ f: number; px: number } | null>(null)
  // where (0..1 of the track) a pointer x (px inside the scroller) falls, kept across the next render
  const at = (px: number) => {
    const el = scroller.current
    const track = el?.querySelector<HTMLElement>("[data-lanes-track]")
    if (!el || !track) return
    const left = track.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft
    const w = track.getBoundingClientRect().width || 1
    anchor.current = { f: (el.scrollLeft + px - left) / w, px }
  }
  /** Zoom to `by(current)`, keeping the instant at pointer x `px` (default: the middle) in place. */
  const zoomTo = (by: (z: number) => number, px?: number) => {
    const el = scroller.current
    if (el) at(px ?? el.clientWidth / 2)
    setZoom((z) => clampZoom(by(z)))
  }
  useLayoutEffect(() => {
    const el = scroller.current, a = anchor.current
    const track = el?.querySelector<HTMLElement>("[data-lanes-track]")
    anchor.current = null
    if (!el || !a || !track) return
    const left = track.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft
    el.scrollLeft = left + a.f * track.getBoundingClientRect().width - a.px
  }, [zoom])
  // React's wheel listener is passive; a native one can stop the page from zooming.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      zoomTo((z) => z * Math.exp(-e.deltaY * 0.004), e.clientX - el.getBoundingClientRect().left)
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  })
  return { zoom, scroller, zoomTo }
}

export function LaneTimeline({ lanes, calls, live, now, onPick, onOpenLane }: Props) {
  const { zoom, scroller, zoomTo } = useZoom()
  const tl = useMemo(() => buildTimeline(lanes, calls, { live, now, zoom }), [lanes, calls, live, now, zoom])
  const counts = useMemo(() => {
    const n: Record<TickKind, number> = { tool: 0, mcp: 0, skill: 0, agent: 0, error: 0 }
    for (const r of tl.rows) for (const t of r.ticks) n[t.kind]++
    return n
  }, [tl])
  const pct = (x: number) => `${x * 100}%`
  const wall = tl.t0 !== null && tl.t1 !== null ? tl.t1 - tl.t0 : 0

  return (
    <div className="flex max-h-[calc(100vh-15rem)] min-h-[180px] flex-col overflow-hidden rounded-xl border bg-card [--namew:260px] max-md:[--namew:150px]" aria-label="Timeline">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-3">
        <b className="font-mono text-[13px] font-bold">Timeline</b>
        <span className="font-mono text-[11px] text-muted-foreground">
          {tl.rows.length} lane{tl.rows.length === 1 ? "" : "s"} · {calls.length} call{calls.length === 1 ? "" : "s"}
          {tl.t0 !== null && ` · active ${dur(tl.activeMs)}`}
          {tl.breaks.length > 0 && ` · wall ${dur(wall)}`}
        </span>
        <span className="flex-1" />
        <span className="flex flex-wrap items-center gap-2.5" aria-label="Legend">
          {KINDS.map((k) => (
            <span key={k} className={cn("flex items-center gap-1 font-mono text-[10.5px] text-muted-foreground", !counts[k] && "opacity-40")}>
              <i className={cn("inline-block h-2.5 w-[3px] rounded-[1px]", TICK[k].bg)} />
              {TICK[k].label} {counts[k]}
            </span>
          ))}
        </span>
        <span className="flex items-center rounded-md border font-mono text-[11px]" aria-label="Zoom">
          <button type="button" aria-label="Zoom out" title="Zoom out (ctrl/⌘ + wheel)" disabled={zoom <= 1} onClick={() => zoomTo((z) => z / 2)} className="px-1.5 py-1 text-muted-foreground hover:text-foreground disabled:opacity-40">
            <Minus className="size-3" />
          </button>
          <button type="button" aria-label="Fit" title="Fit the whole span" disabled={zoom === 1} onClick={() => zoomTo(() => 1)} className="min-w-[3.2em] border-x px-1.5 py-0.5 text-muted-foreground tabular-nums hover:text-foreground disabled:hover:text-muted-foreground">
            {zoom === 1 ? "fit" : `×${zoom < 10 ? zoom.toFixed(1).replace(/\.0$/, "") : Math.round(zoom)}`}
          </button>
          <button type="button" aria-label="Zoom in" title="Zoom in (ctrl/⌘ + wheel)" disabled={zoom >= MAX_ZOOM} onClick={() => zoomTo((z) => z * 2)} className="px-1.5 py-1 text-muted-foreground hover:text-foreground disabled:opacity-40">
            <Plus className="size-3" />
          </button>
        </span>
        {live && (
          <span className="flex items-center gap-1.5 rounded-full border border-running/40 bg-running/10 px-2 py-0.5 font-mono text-[11px] text-running">
            <i className="mc-pulse size-1.5 rounded-full bg-running" />
            Live
          </span>
        )}
      </div>
      {tl.rows.length === 0 ? (
        <p className="m-auto px-4 text-center font-mono text-[13px] text-muted-foreground">No lanes or calls recorded for this item yet.</p>
      ) : (
        <div ref={scroller} data-scroller className="min-h-0 flex-1 overflow-auto">
          <div data-track data-zoom={zoom} className="relative min-w-[calc(var(--namew)+520px)] pb-6" style={zoom > 1 ? { width: `calc(var(--namew) + ${zoom} * (100% - var(--namew)))` } : undefined}>
            {/* axis */}
            <div className="sticky top-0 z-30 grid h-[30px] grid-cols-[var(--namew)_minmax(0,1fr)] border-b bg-card">
              <div className="sticky left-0 z-10 flex items-center border-r bg-card pl-4 font-mono text-[10px] tracking-widest text-muted-foreground">LANE</div>
              <div data-lanes-track className="relative mr-14 ml-3">
                {tl.breaks.map((b, i) => (
                  <span key={i} title={`idle ${dur(b.realMs)}`} className={cn("absolute bottom-0 h-3 min-w-1.5 cursor-help border-x", HATCH)} style={{ left: pct(b.x), width: pct(b.w) }}>
                    <span className="sr-only">idle {dur(b.realMs)}</span>
                  </span>
                ))}
                {tl.marks.map((m, i) => (
                  <span key={i} className={cn("absolute top-2 font-mono text-[10.5px] whitespace-nowrap text-muted-foreground/80", m.x > 0 && (m.x >= 1 ? "-translate-x-full" : "-translate-x-1/2"))} style={{ left: pct(m.x) }}>
                    {m.label}
                  </span>
                ))}
              </div>
            </div>
            {/* hatches under the rows, the live edge over them */}
            <div className="pointer-events-none absolute top-[30px] right-14 bottom-0 left-[calc(var(--namew)+12px)] z-0">
              {tl.breaks.map((b, i) => (
                <i key={i} className={cn("absolute top-0 bottom-0 min-w-1.5 border-x", HATCH)} style={{ left: pct(b.x), width: pct(b.w) }} />
              ))}
            </div>
            {tl.rows.map((r) => (
              <div key={r.lane.id} data-lane-row={r.lane.id} className="group grid h-[30px] grid-cols-[var(--namew)_minmax(0,1fr)] hover:bg-muted/40">
                <button
                  type="button"
                  onClick={() => onOpenLane?.(r.lane.id)}
                  title={r.lane.reason ?? r.lane.label}
                  className="sticky left-0 z-[6] flex min-w-0 items-center gap-2 border-r bg-card pr-2.5 pl-4 text-left text-[12.5px] group-hover:bg-muted"
                >
                  <StatusDot status={r.lane.status} />
                  <span className={cn("min-w-0 flex-1 truncate", r.lane.kind === "main" && "font-semibold")}>{r.lane.label}</span>
                  <span className="flex-none font-mono text-[10.5px] text-muted-foreground">{r.ticks.length || ""}</span>
                </button>
                <div className="relative mr-14 ml-3">
                  {r.a === null || r.b === null ? (
                    <span className="absolute top-1/2 left-0 -translate-y-1/2 font-mono text-[10.5px] text-faint">no timestamps</span>
                  ) : (
                    <>
                      <i
                        data-bar
                        className={cn(
                          "absolute top-[9px] h-3 min-w-[3px] rounded-[3px] border",
                          r.running ? "border-running/60 bg-running/15" : r.lane.status === "failed" ? "border-failed/60 bg-failed/15" : "border-zinc-600 bg-zinc-700/40",
                        )}
                        style={{ left: pct(r.a), width: pct(Math.max(0, r.b - r.a)) }}
                      />
                      <span className="pointer-events-none absolute top-1/2 -translate-y-1/2 pl-1.5 font-mono text-[10.5px] whitespace-nowrap text-muted-foreground" style={{ left: pct(r.b) }}>
                        {dur(r.realMs)}
                      </span>
                    </>
                  )}
                  {r.ticks.map((t) => (
                    <button
                      key={t.call.id}
                      type="button"
                      data-tick={t.kind}
                      aria-label={`${displayName(t.call)} ${t.call.summary} at ${fmtTime(t.call.ts)}`}
                      title={`${displayName(t.call)} · ${fmtTime(t.call.ts)}\n${t.call.summary}${t.call.error ? `\n${t.call.error}` : ""}`}
                      onClick={() => onPick(t.call)}
                      className={cn(
                        "absolute z-[3] w-[3px] -translate-x-1/2 rounded-[1px] hover:z-[4] hover:w-[5px] hover:ring-1 hover:ring-foreground focus-visible:ring-1 focus-visible:ring-foreground focus-visible:outline-none",
                        t.kind === "error" ? "top-[5px] h-5" : "top-[7px] h-4",
                        TICK[t.kind].bg,
                      )}
                      style={{ left: pct(t.x) }}
                    />
                  ))}
                </div>
              </div>
            ))}
            {tl.playhead !== null && (
              <div className="pointer-events-none absolute top-0 right-14 bottom-0 left-[calc(var(--namew)+12px)] z-[5]">
                <i className="absolute top-0 bottom-0 w-px bg-running/80" style={{ left: pct(tl.playhead) }}>
                  <i className="mc-pulse absolute top-[24px] -left-[3px] size-[7px] rounded-full bg-running" />
                </i>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
