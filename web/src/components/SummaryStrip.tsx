import type { ReactNode } from "react"
import type { ItemDetail } from "@/lib/api"
import { compact } from "@/lib/format"
import { EST_TIP, estCost, span, summarize } from "@/lib/item"
import { STATUS_TEXT } from "@/components/StatusDot"
import { statusTitle } from "@/lib/status-ui"
import { cn } from "@/lib/utils"
import { Strip, StripCell } from "@/components/Panel"

const Cell = StripCell

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
    <Strip label="Summary" className="grid-cols-2 sm:grid-cols-5 xl:grid-cols-10">
      <Cell k="Status" className={cn("text-sm", STATUS_TEXT[s.status])}>
        {statusTitle(s.status)}
      </Cell>
      <Cell k="Lanes working" className={s.running ? "text-running" : undefined}>{s.running}</Cell>
      <Cell k={L.subagents > 0 ? "Lanes" : L.stages > 0 ? "Stages done" : "Lanes"}>{lanes}</Cell>
      <Cell k="Duration" tip="Wall clock, first to last activity. The Timeline also shows active time (idle breaks folded)">{span(s.durationMs)}<span className="ml-1 text-xs font-normal text-muted-foreground">wall</span></Cell>
      <Cell k="Calls">{compact(s.calls)}</Cell>
      <Cell k="Issues" tip="Failed calls (a session) or issues raised (a run)" className={s.errors ? "text-failed" : undefined}>{s.errors}</Cell>
      <Cell k="Tokens" tip="Input, output, cache writes and cache reads">{compact(s.tokens)}</Cell>
      <Cell k="Cache hit" tip="Cache reads over all input">
        {s.cache === null ? "–" : `${Math.round(s.cache * 100)}%`}
      </Cell>
      <Cell k="Cost" tip={EST_TIP}>
        {estCost(s.cost).replace(/ est\.$/, "")}
        {s.cost > 0 && <span className="ml-1 text-xs font-normal text-muted-foreground">est.</span>}
      </Cell>
      <Cell k="Models" className="font-mono text-xs leading-snug font-normal whitespace-normal">
        {s.models.length ? s.models.join(" · ") : "–"}
      </Cell>
    </Strip>
  )
}
