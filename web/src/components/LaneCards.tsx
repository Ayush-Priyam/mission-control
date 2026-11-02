import { useState } from "react"
import { ChevronRight } from "lucide-react"
import type { Call, CallKind, Lane, Status } from "@/lib/api"
import { ago, compact } from "@/lib/format"
import { estCost, EST_TIP, laneTree, modelName, totalTokens, type Chip, type LaneExtra } from "@/lib/item"
import { iconOf, KIND } from "@/components/CallList"
import { StatusDot } from "@/components/StatusDot"
import { cn } from "@/lib/utils"

const BORDER: Record<Status, string> = {
  working: "border-running/45",
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
  if (lane.status === "waiting") return "waiting on you"
  if (lane.status === "stopped") return "stopped"
  if (lane.status === "failed") return "failed"
  if (x?.skipped) return "skipped"
  if (lane.status === "working" && x && x.rounds > 1) return `round ${x.rounds}`
  if (lane.status === "working") return "working"
  if (lane.status === "idle") return lane.calls ? "idle" : "queued"
  return x && x.rounds > 1 ? `done · r${x.rounds}` : "done"
}

function NowDoing({ lane, now }: { lane: Lane; now: number }) {
  const d = lane.nowDoing
  if (!d) return <p className="text-[13px] text-muted-foreground">{lane.status === "idle" && !lane.calls ? "not started" : "no calls yet"}</p>
  const kind = (d.kind in KIND ? d.kind : "tool") as CallKind
  const Icon = iconOf({ name: d.name, kind } as Call)
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="flex min-w-0 items-center gap-1.5 font-mono text-[13px]">
        <Icon className={cn("size-3.5 shrink-0", KIND[kind].text)} />
        <span className="shrink-0 font-semibold">{d.name}</span>
        <span className="min-w-0 truncate text-muted-foreground" title={d.summary}>{d.summary}</span>
      </div>
      <div className="font-mono text-[11px] text-faint">
        {lane.status === "working" ? `${ago(d.ts, now)} ago` : `last ${ago(d.ts, now)} ago`}
        {lane.model ? ` · ${modelName(lane.model)}` : ""}
      </div>
    </div>
  )
}

/** One lane: dot, label, corner word, what it is doing now, why (chip), and its calls/tokens/cost. */
export function LaneCard({ lane, extra, now, onOpen, compactCard }: { lane: Lane; extra?: LaneExtra; now: number; onOpen?: (id: string) => void; compactCard?: boolean }) {
  const quiet = lane.status === "idle" || lane.status === "done" || lane.status === "stopped"
  const chip = extra?.chip
  return (
    <button
      type="button"
      data-lane={lane.id}
      data-status={lane.status}
      onClick={() => onOpen?.(lane.id)}
      className={cn(
        "flex min-w-0 flex-col gap-2.5 rounded-xl border bg-card p-3.5 text-left transition-colors hover:border-ring",
        BORDER[lane.status],
        quiet && "bg-card/60",
        compactCard && "gap-2 p-3",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <StatusDot status={lane.status} />
        <span className={cn("min-w-0 flex-1 truncate font-semibold", compactCard ? "text-sm" : "text-[15px]", quiet && "text-muted-foreground")} title={lane.label}>
          {lane.label}
        </span>
        <span className={cn("shrink-0 font-mono text-[11px]", lane.status === "waiting" ? "text-needs-you" : lane.status === "failed" ? "text-failed" : "text-faint")}>
          {corner(lane, extra)}
        </span>
      </div>
      <NowDoing lane={lane} now={now} />
      {chip && (
        <span className={cn("line-clamp-2 self-start rounded px-1.5 py-0.5 font-mono text-[11px]", CHIP[chip.kind], "max-w-full")} title={chip.text}>
          {chip.text}
        </span>
      )}
      <div className="mt-auto flex items-center justify-between gap-2 font-mono text-[11px] whitespace-nowrap text-faint">
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
function QuietRows({ lanes, onOpen }: { lanes: Lane[]; onOpen?: (id: string) => void }) {
  return (
    <ol className="flex flex-col">
      {lanes.map((l) => (
        <li key={l.id}>
          <button
            type="button"
            data-lane={l.id}
            data-status={l.status}
            onClick={() => onOpen?.(l.id)}
            className="grid w-full grid-cols-[auto_minmax(0,1fr)_70px_60px_90px] items-center gap-3 rounded-md px-2 py-1 text-left text-[13px] hover:bg-accent/50"
          >
            <StatusDot status={l.status} />
            <span className="truncate" title={l.label}>{l.label}</span>
            <span className="font-mono text-[11px] text-faint">{l.model ? modelName(l.model) : ""}</span>
            <span className="text-right font-mono text-[11px] text-muted-foreground">{l.calls}</span>
            <span className="text-right font-mono text-[11px] text-faint" title={EST_TIP}>{estCost(l.cost)}</span>
          </button>
        </li>
      ))}
    </ol>
  )
}

const busy = (l: Lane) => l.status === "working" || l.status === "waiting" || l.status === "failed"

/**
 * The Lanes tab: a card per top-level lane, subagents nested under their parent with a count
 * (busy ones as cards, the rest as rows). A run's finished stages fold into one "Done" line.
 */
export function LaneCards({ lanes, extras, now, onOpen }: { lanes: Lane[]; extras: Map<string, LaneExtra>; now: number; onOpen?: (id: string) => void }) {
  const [showQuiet, setShowQuiet] = useState<Record<string, boolean>>({})
  if (!lanes.length) return <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No lanes recorded for this item.</p>
  const groups = laneTree(lanes)
  const stageRun = groups.every((g) => g.lane.kind === "stage" || g.lane.kind === "crew")
  const folded = stageRun ? groups.filter((g) => g.lane.status === "done" || extras.get(g.lane.id)?.skipped) : []
  const shown = groups.filter((g) => !folded.includes(g))
  const parents = shown.filter((g) => g.children.length)
  const singles = shown.filter((g) => !g.children.length)

  return (
    <div className="flex flex-col gap-4">
      {parents.map(({ lane, children }) => {
        const active = children.filter(busy)
        const quiet = children.filter((c) => !busy(c))
        const open = showQuiet[lane.id] ?? quiet.length <= 12
        return (
          <section key={lane.id} className="flex flex-col gap-3" aria-label={`${lane.label} and its subagents`}>
            <LaneCard lane={lane} extra={extras.get(lane.id)} now={now} onOpen={onOpen} />
            <div className="ml-3 flex flex-col gap-2 border-l pl-4">
              <div className="font-mono text-[11px] tracking-wider text-faint uppercase">
                Subagents · {children.length}
                {active.length ? <span className="text-running"> · {active.length} busy</span> : null}
              </div>
              {active.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {active.map((c) => (
                    <LaneCard key={c.id} lane={c} extra={extras.get(c.id)} now={now} onOpen={onOpen} compactCard />
                  ))}
                </div>
              )}
              {quiet.length > 0 && (
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => setShowQuiet((s) => ({ ...s, [lane.id]: !open }))}
                    className="flex items-center gap-1 self-start font-mono text-[11px] text-muted-foreground hover:text-foreground"
                    aria-expanded={open}
                  >
                    <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
                    {quiet.length} finished or idle
                  </button>
                  {open && <QuietRows lanes={quiet} onOpen={onOpen} />}
                </div>
              )}
            </div>
          </section>
        )
      })}
      {singles.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {singles.map(({ lane }) => (
            <LaneCard key={lane.id} lane={lane} extra={extras.get(lane.id)} now={now} onOpen={onOpen} />
          ))}
        </div>
      )}
      {folded.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground" aria-label="Done">
          <span>Done</span>
          {folded.map(({ lane }) =>
            extras.get(lane.id)?.skipped ? (
              <span key={lane.id} className="text-faint">— {lane.label} skipped</span>
            ) : (
              <button key={lane.id} type="button" onClick={() => onOpen?.(lane.id)} className="hover:text-foreground">
                <span className="text-running">✓</span> {lane.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}
