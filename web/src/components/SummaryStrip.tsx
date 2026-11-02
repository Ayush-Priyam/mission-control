import type { ReactNode } from "react"
import type { ItemDetail } from "@/lib/api"
import { compact } from "@/lib/format"
import { EST_TIP, estCost, span, summarize } from "@/lib/item"
import { STATUS_LABEL, STATUS_TEXT } from "@/components/StatusDot"
import { cn } from "@/lib/utils"

function Cell({ k, children, tip, className }: { k: string; children: ReactNode; tip?: string; className?: string }) {
  return (
    <div className="min-w-0 bg-card px-3 py-2.5" title={tip}>
      <div className="text-[11px] text-muted-foreground">{k}</div>
      <div className={cn("mt-0.5 truncate text-lg font-semibold tracking-tight tabular-nums", className)}>{children}</div>
    </div>
  )
}

/** The row of numbers on top of an item: status, running, lanes, duration, calls, errors, tokens, cache, cost, models. */
export function SummaryStrip({ detail, now }: { detail: ItemDetail; now: number }) {
  const s = summarize(detail, now)
  const L = s.lanes
  const lanes =
    L.subagents > 0 ? (
      <>
        {L.main || 1} <span className="text-sm font-normal text-muted-foreground">+ {L.subagents} sub</span>
      </>
    ) : L.stages > 0 ? (
      <>
        {L.done}
        <span className="text-sm font-normal text-muted-foreground">/{L.total}</span>
      </>
    ) : (
      L.total
    )
  return (
    <section aria-label="Summary" className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-5 xl:grid-cols-10">
      <Cell k="Status" className={cn("text-sm", STATUS_TEXT[s.status])}>
        {s.status === "waiting" ? "Needs you" : STATUS_LABEL[s.status][0].toUpperCase() + STATUS_LABEL[s.status].slice(1)}
      </Cell>
      <Cell k="Running" className={s.running ? "text-running" : undefined}>{s.running}</Cell>
      <Cell k={L.subagents > 0 ? "Lanes" : L.stages > 0 ? "Stages done" : "Lanes"}>{lanes}</Cell>
      <Cell k="Duration">{span(s.durationMs)}</Cell>
      <Cell k="Calls">{compact(s.calls)}</Cell>
      <Cell k="Errors" className={s.errors ? "text-failed" : undefined}>{s.errors}</Cell>
      <Cell k="Tokens" tip="Input, output, cache writes and cache reads">{compact(s.tokens)}</Cell>
      <Cell k="Cache hit" className={s.cache !== null ? "text-consult" : undefined} tip="Cache reads over all input">
        {s.cache === null ? "–" : `${Math.round(s.cache * 100)}%`}
      </Cell>
      <Cell k="Cost" tip={EST_TIP}>
        {estCost(s.cost).replace(/ est\.$/, "")}
        {s.cost > 0 && <span className="ml-1 text-xs font-normal text-muted-foreground">est.</span>}
      </Cell>
      <Cell k="Models" className="font-mono text-xs leading-snug font-normal whitespace-normal">
        {s.models.length ? s.models.join(" · ") : "–"}
      </Cell>
    </section>
  )
}
