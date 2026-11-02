import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { ChevronRight } from "lucide-react"
import type { Call, CallKind, Lane, Status } from "@/lib/api"
import { ago, compact, loopLine, sinceChangeLine } from "@/lib/format"
import { estCost, EST_TIP, laneTree, modelName, totalTokens, type Chip, type LaneExtra } from "@/lib/item"
import { iconOf, KIND } from "@/components/CallList"
import { StatusDot } from "@/components/StatusDot"
import type { LaneLink } from "@/lib/map"
import { cn } from "@/lib/utils"

const BORDER: Record<Status, string> = {
  working: "border-running/45",
  looping: "border-looping/70",
  waiting: "border-needs-you/80 shadow-[0_0_0_1px_var(--needs-you),0_0_18px_-6px_var(--needs-you)]",
  failed: "border-failed/60",
  stopped: "border-stopped/40 border-dashed",
  done: "border-border",
  idle: "border-border",
}

const CHIP: Record<Chip["kind"], string> = {
  sendback: "bg-failed/12 text-failed",
  consult: "bg-consult/12 text-consult",
  waiting: "bg-needs-you/12 text-needs-you",
  stopped: "bg-stopped/12 text-stopped",
}

/** The corner word: rounds while active, else the status (a non-owner stop is `stopped`, never `failed`). */
function corner(lane: Lane, x: LaneExtra | undefined): string {
  if (lane.status === "waiting") return "needs you"
  if (lane.status === "stopped") return "stopped"
  if (lane.status === "failed") return "failed"
  if (lane.status === "looping") return "looping"
  if (x?.skipped) return "skipped"
  if (lane.status === "working" && x && x.rounds > 1) return `round ${x.rounds}`
  if (lane.status === "working") return "working"
  if (lane.status === "idle") return lane.calls ? "idle" : "queued"
  return x && x.rounds > 1 ? `done · r${x.rounds}` : "done"
}

function NowDoing({ lane, now }: { lane: Lane; now: number }) {
  const d = lane.nowDoing
  if (!d) return <p className="text-body text-muted-foreground">{lane.status === "idle" && !lane.calls ? "not started" : "no calls yet"}</p>
  const kind = (d.kind in KIND ? d.kind : "tool") as CallKind
  const Icon = iconOf({ name: d.name, kind } as Call)
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="flex min-w-0 items-center gap-1.5 font-mono text-body">
        <Icon className={cn("size-3.5 shrink-0", KIND[kind].text)} />
        <span className="shrink-0 font-semibold">{d.name}</span>
        <span className="min-w-0 truncate text-muted-foreground" title={d.summary}>{d.summary}</span>
      </div>
      <div className="font-mono text-xs text-faint">
        {lane.status === "working" ? `${ago(d.ts, now)} ago` : `last ${ago(d.ts, now)} ago`}
        {lane.model ? ` · ${modelName(lane.model)}` : ""}
      </div>
    </div>
  )
}

/** How a card relates to the one under the pointer. */
export type Linked = { kind: LaneLink["kind"]; text: string }
type Look = { linked?: Linked; flash?: boolean; onHover?: (id: string | null) => void }

const LINKED: Record<Linked["kind"], { ring: string; text: string }> = {
  sendback: { ring: "ring-1 ring-failed/55", text: "text-failed" },
  consult: { ring: "ring-1 ring-consult/55", text: "text-consult" },
}

/** One lane: dot, label, corner word, what it is doing now, why (chip), and its calls/tokens/cost. */
/**
 * The looping line and its link to the first failing call. The card is a button, so the link is a
 * keyboard-reachable role="link" that navigates without opening the lane.
 */
function LoopLine({ lane, now, callHref }: { lane: Lane; now: number; callHref?: (callId: string) => string }) {
  const loop = lane.loop
  if (lane.status !== "looping" || !loop) return null
  const href = callHref?.(loop.firstCallId)
  const go = (e: { stopPropagation: () => void; preventDefault: () => void }) => {
    e.stopPropagation()
    e.preventDefault()
    if (href) location.hash = href.replace(/^#/, "")
  }
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-md bg-looping/10 px-2 py-1 font-mono text-xs text-looping">
      <span className="line-clamp-3" title={loop.command}>{loopLine(loop, now)}</span>
      {href && (
        <span
          role="link"
          tabIndex={0}
          data-href={href}
          onClick={go}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && go(e)}
          className="self-start underline decoration-dotted underline-offset-2 hover:decoration-solid"
        >
          first failing call →
        </span>
      )}
    </div>
  )
}

export function LaneCard({ lane, extra, now, onOpen, compactCard, linked, flash, onHover, callHref }: { lane: Lane; extra?: LaneExtra; now: number; onOpen?: (id: string) => void; compactCard?: boolean; callHref?: (callId: string) => string } & Look) {
  const quiet = lane.status === "idle" || lane.status === "done" || lane.status === "stopped"
  const chip = extra?.chip
  return (
    <button
      type="button"
      data-lane={lane.id}
      data-status={lane.status}
      data-linked={linked?.kind}
      onClick={() => onOpen?.(lane.id)}
      onMouseEnter={() => onHover?.(lane.id)}
      onMouseLeave={() => onHover?.(null)}
      onFocus={() => onHover?.(lane.id)}
      onBlur={() => onHover?.(null)}
      className={cn(
        "relative flex min-w-0 flex-col gap-2.5 rounded-xl border bg-card p-3.5 text-left transition-[border-color,box-shadow] hover:border-ring",
        BORDER[lane.status],
        quiet && "bg-card/60",
        compactCard && "gap-2 p-3",
        linked && LINKED[linked.kind].ring,
        flash && "mc-flash",
      )}
    >
      {linked && (
        <span className={cn("absolute -top-2 right-3 max-w-[85%] truncate rounded bg-background px-1.5 font-mono text-xs", LINKED[linked.kind].text)} title={linked.text}>
          {linked.text}
        </span>
      )}
      <div className="flex min-w-0 items-center gap-2">
        <StatusDot status={lane.status} />
        <span className={cn("min-w-0 flex-1 truncate font-semibold", compactCard ? "text-sm" : "text-title", quiet && "text-muted-foreground")} title={lane.label}>
          {lane.label}
        </span>
        <span className={cn("shrink-0 font-mono text-xs", lane.status === "waiting" ? "text-needs-you" : lane.status === "failed" ? "text-failed" : lane.status === "looping" ? "text-looping" : "text-faint")}>
          {corner(lane, extra)}
        </span>
      </div>
      <NowDoing lane={lane} now={now} />
      <LoopLine lane={lane} now={now} callHref={callHref} />
      {chip && (
        <span className={cn("line-clamp-2 self-start rounded px-1.5 py-0.5 font-mono text-xs", CHIP[chip.kind], "max-w-full")} title={chip.text}>
          {chip.text}
        </span>
      )}
      {sinceChangeLine(lane.sinceChange) && (lane.status === "working" || lane.status === "looping") && (
        <span data-since-change className="font-mono text-xs text-faint">{sinceChangeLine(lane.sinceChange)}</span>
      )}
      <div className="mt-auto flex items-center justify-between gap-2 font-mono text-xs whitespace-nowrap text-faint">
        <span title={EST_TIP} className="shrink-0">{estCost(lane.cost)}</span>
        <span className="min-w-0 truncate">
          {lane.calls} call{lane.calls === 1 ? "" : "s"}
          {lane.errors ? <span className="text-failed"> · {lane.errors} err</span> : null}
          {totalTokens(lane.tokens) ? ` · ${compact(totalTokens(lane.tokens))} tok` : ""}
        </span>
      </div>
    </button>
  )
}

/** Quiet subagents (done or idle) as one row each, under the busy ones. */
function QuietRows({ lanes, onOpen, look }: { lanes: Lane[]; onOpen?: (id: string) => void; look: (id: string) => Look }) {
  return (
    <ol className="flex flex-col">
      {lanes.map((l) => (
        <li key={l.id}>
          <button
            type="button"
            data-lane={l.id}
            data-status={l.status}
            data-linked={look(l.id).linked?.kind}
            onClick={() => onOpen?.(l.id)}
            className={cn("grid w-full grid-cols-[auto_minmax(0,1fr)_70px_60px_90px] items-center gap-3 rounded-md px-2 py-1 text-left text-body hover:bg-accent/50", look(l.id).flash && "mc-flash")}
          >
            <StatusDot status={l.status} />
            <span className="truncate" title={l.label}>{l.label}</span>
            <span className="font-mono text-xs text-faint">{l.model ? modelName(l.model) : ""}</span>
            <span className="text-right font-mono text-xs text-muted-foreground">{l.calls}</span>
            <span className="text-right font-mono text-xs text-faint" title={EST_TIP}>{estCost(l.cost)}</span>
          </button>
        </li>
      ))}
    </ol>
  )
}

const busy = (l: Lane) => l.status === "working" || l.status === "looping" || l.status === "waiting" || l.status === "failed"
const sel = (ids: string[]) => ids.map((id) => `[data-lane="${id.replace(/["\\]/g, "\\$&")}"]`).join(",")

/** What each card is to the hovered lane: "sent back X3 to backend", "got X3 back from qa", "asked Q4 by backend". */
export function linkedTo(hover: string | null, links: LaneLink[], label: (id: string) => string): Map<string, Linked> {
  const out = new Map<string, Linked>()
  if (!hover) return out
  const name = label(hover)
  const add = (id: string, kind: Linked["kind"], text: string) => {
    const was = out.get(id)
    out.set(id, { kind: was?.kind === "sendback" ? "sendback" : kind, text: was ? `${was.text} · ${text}` : text })
  }
  for (const l of links) {
    const ids = l.labels.join(", ")
    const sp = ids ? ` ${ids}` : ""
    if (l.from === hover) add(l.to, l.kind, l.kind === "sendback" ? `got${sp || " work"} back from ${name}` : `asked${sp} by ${name}`)
    else if (l.to === hover) add(l.from, l.kind, l.kind === "sendback" ? `sent back${sp} to ${name}` : `asked ${name}${sp}`)
  }
  return out
}

/** Cards in a grid; two or more working at once lead in their own row, labelled. */
function CardGrid({ lanes, render }: { lanes: Lane[]; render: (l: Lane) => ReactNode; compactCard?: boolean }) {
  const together = lanes.filter((l) => l.status === "working")
  const rest = together.length >= 2 ? lanes.filter((l) => !together.includes(l)) : lanes
  const grid = "grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
  return (
    <>
      {together.length >= 2 && (
        <section aria-label={`running in parallel · ${together.length}`} className="flex flex-col gap-2 rounded-2xl border border-dashed border-running/30 bg-running/[0.03] p-2.5">
          <div className="flex items-center gap-1.5 px-1 font-mono text-xs tracking-wider text-running uppercase">
            <i className="mc-pulse size-1.5 rounded-full bg-running" />
            running in parallel · {together.length}
          </div>
          <div className={cn("grid gap-3", together.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 xl:grid-cols-3")}>{together.map(render)}</div>
        </section>
      )}
      {rest.length > 0 && <div className={grid}>{rest.map(render)}</div>}
    </>
  )
}

/**
 * The Lanes tab: a card per top-level lane, subagents nested under their parent with a count
 * (busy ones as cards, the rest as rows). A run's finished stages fold into one "Done" line.
 * Hovering a card outlines its linked cards and reports the lane to `onHover` (the flow strip lights its node
 * and arcs); `focus` (from the flow strip) scrolls to a lane and flashes it.
 */
export function LaneCards({ lanes, extras, now, onOpen, links = [], focus, onHover, callHref }: { lanes: Lane[]; extras: Map<string, LaneExtra>; now: number; onOpen?: (id: string) => void; links?: LaneLink[]; focus?: { ids: string[]; n: number } | null; onHover?: (id: string | null) => void; callHref?: (callId: string) => string }) {
  const [showQuiet, setShowQuiet] = useState<Record<string, boolean>>({})
  const [hover, setHoverState] = useState<string | null>(null)
  const setHover = (id: string | null) => { setHoverState(id); onHover?.(id) }
  const [flash, setFlash] = useState<string[]>([])
  const root = useRef<HTMLDivElement>(null)
  const labels = useMemo(() => new Map(lanes.map((l) => [l.id, l.label])), [lanes])
  const related = useMemo(() => linkedTo(hover, links, (id) => labels.get(id) ?? id), [hover, links, labels])

  useEffect(() => {
    if (!focus?.ids.length) return
    const parents = lanes.filter((l) => focus.ids.includes(l.id) && l.parent).map((l) => l.parent!)
    if (parents.length) setShowQuiet((s) => ({ ...s, ...Object.fromEntries(parents.map((p) => [p, true])) }))
    setFlash(focus.ids)
    const t = setTimeout(() => setFlash([]), 1800)
    return () => clearTimeout(t)
    // a new request is a new `n`; the lanes polled in between do not re-trigger it
  }, [focus?.n])
  useEffect(() => {
    if (flash.length) root.current?.querySelector(sel(flash))?.scrollIntoView({ behavior: "smooth", block: "center" })
  }, [flash, showQuiet])

  if (!lanes.length) return <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No lanes recorded for this item.</p>
  const look = (id: string): Look => ({ linked: related.get(id), flash: flash.includes(id), onHover: setHover })
  const groups = laneTree(lanes)
  const stageRun = groups.every((g) => g.lane.kind === "stage" || g.lane.kind === "crew")
  const folded = stageRun ? groups.filter((g) => g.lane.status === "done" || extras.get(g.lane.id)?.skipped) : []
  const shown = groups.filter((g) => !folded.includes(g))
  const parents = shown.filter((g) => g.children.length)
  const singles = shown.filter((g) => !g.children.length)

  return (
    <div ref={root} className="flex flex-col gap-4">
      {parents.map(({ lane, children }) => {
        const active = children.filter(busy)
        const quiet = children.filter((c) => !busy(c))
        const open = showQuiet[lane.id] ?? quiet.length <= 12
        return (
          <section key={lane.id} className="flex flex-col gap-3" aria-label={`${lane.label} and its subagents`}>
            <LaneCard lane={lane} extra={extras.get(lane.id)} now={now} onOpen={onOpen} callHref={callHref} {...look(lane.id)} />
            <div className="ml-3 flex flex-col gap-2 border-l pl-4">
              <div className="font-mono text-xs tracking-wider text-faint uppercase">
                Subagents · {children.length}
                {active.length ? <span className="text-running"> · {active.length} busy</span> : null}
              </div>
              {active.length > 0 && (
                <CardGrid compactCard lanes={active} render={(c) => <LaneCard key={c.id} lane={c} extra={extras.get(c.id)} now={now} onOpen={onOpen} callHref={callHref} compactCard {...look(c.id)} />} />
              )}
              {quiet.length > 0 && (
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => setShowQuiet((s) => ({ ...s, [lane.id]: !open }))}
                    className="flex items-center gap-1 self-start font-mono text-xs text-muted-foreground hover:text-foreground"
                    aria-expanded={open}
                  >
                    <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
                    {quiet.length} finished or idle
                  </button>
                  {open && <QuietRows lanes={quiet} onOpen={onOpen} look={look} />}
                </div>
              )}
            </div>
          </section>
        )
      })}
      {singles.length > 0 && <CardGrid lanes={singles.map((g) => g.lane)} render={(l) => <LaneCard key={l.id} lane={l} extra={extras.get(l.id)} now={now} onOpen={onOpen} callHref={callHref} {...look(l.id)} />} />}
      {folded.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground" aria-label="Done">
          <span>Done</span>
          {folded.map(({ lane }) =>
            extras.get(lane.id)?.skipped ? (
              <span key={lane.id} data-lane={lane.id} className={cn("rounded text-faint", flash.includes(lane.id) && "mc-flash")}>— {lane.label} skipped</span>
            ) : (
              <button key={lane.id} type="button" data-lane={lane.id} data-linked={related.get(lane.id)?.kind} onClick={() => onOpen?.(lane.id)} onMouseEnter={() => setHover(lane.id)} onMouseLeave={() => setHover(null)} className={cn("inline-flex min-h-6 items-center gap-1 rounded px-1 hover:bg-muted hover:text-foreground", flash.includes(lane.id) && "mc-flash", related.has(lane.id) && LINKED[related.get(lane.id)!.kind].text)}>
                <span className="text-running">✓</span> {lane.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}
