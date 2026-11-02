import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { ScrollArea } from "@/components/ui/scroll-area"
import { CallName, fmtTime, outcome, TONE } from "@/components/CallList"
import { StageLog } from "@/components/StageLog"
import { StatusDot, STATUS_LABEL } from "@/components/StatusDot"
import { useCalls, type ItemDetail, type Lane } from "@/lib/api"
import { stageEvents } from "@/lib/events"
import { compact } from "@/lib/format"
import { estCost, EST_TIP, modelName, totalTokens } from "@/lib/item"
import { toHash } from "@/lib/route"
import { cn } from "@/lib/utils"

const MAX_CALLS = 200

function LaneCalls({ source, id, lane, live }: { source: string; id: string; lane: string; live: boolean }) {
  const calls = useCalls(source, id, { lane }, live ? 5000 : 0)
  if (calls.loading && !calls.data) return <p className="font-mono text-xs text-muted-foreground">Loading calls…</p>
  if (calls.error && !calls.data) return <p className="font-mono text-xs text-failed">{calls.error}</p>
  const list = (calls.data ?? []).slice(-MAX_CALLS).reverse()
  if (!list.length) return <p className="font-mono text-xs text-muted-foreground">No calls in this lane.</p>
  return (
    <ol className="flex flex-col gap-0.5 font-mono text-xs">
      {list.map((c) => {
        const o = outcome(c)
        return (
          <li key={c.id} className="grid grid-cols-[60px_minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-2 py-0.5">
            <span className="text-faint">{fmtTime(c.ts)}</span>
            <CallName call={c} className="min-w-0" />
            <span className="truncate text-muted-foreground" title={c.summary}>{c.summary}</span>
            <span className={TONE[o.tone]}>{o.text}</span>
          </li>
        )
      })}
    </ol>
  )
}

/** A lane's sheet (from the map or a lane card): status, model, cost, its run events if any, and its calls. */
export function LaneSheet({ detail, lanes, onClose }: { detail: ItemDetail; lanes: Lane[]; onClose: () => void }) {
  const lane = lanes[0]
  const s = detail.summary
  const events = Array.isArray(detail.events) ? detail.events : []
  const mine = lanes.length && events.length ? stageEvents(events, lanes.map((l) => l.id)) : []
  return (
    <Sheet open={!!lane} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-xl">
        {lane && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <StatusDot status={lane.status} />
                <span className="truncate">{lane.label}</span>
              </SheetTitle>
              <SheetDescription className="font-mono text-xs">
                {STATUS_LABEL[lane.status]}
                {lane.model ? ` · ${modelName(lane.model)}` : ""} · {lane.calls} calls
                {totalTokens(lane.tokens) ? ` · ${compact(totalTokens(lane.tokens))} tok` : ""} · <span title={EST_TIP}>{estCost(lane.cost)}</span>
                {lanes.length > 1 ? ` · stages ${lanes.map((l) => l.id).join(", ")}` : ""}
              </SheetDescription>
              {lane.reason && <p className={cn("text-sm", lane.status === "waiting" ? "text-needs-you" : "text-muted-foreground")}>{lane.reason}</p>}
              <div className="flex gap-3 font-mono text-[11px] text-muted-foreground">
                <a className="underline hover:text-foreground" href={toHash({ view: "item", source: s.source, id: s.id, tab: "calls" })}>
                  all calls
                </a>
                <a className="underline hover:text-foreground" href={toHash({ view: "item", source: s.source, id: s.id, tab: "timeline" })}>
                  timeline
                </a>
              </div>
            </SheetHeader>
            <ScrollArea className="min-h-0 flex-1 px-4 pb-4">
              {events.length > 0 && (
                <div className="mb-4 flex flex-col gap-2">
                  <h4 className="font-mono text-[11px] tracking-wider text-faint uppercase">Log</h4>
                  <StageLog events={mine} empty="No events for this stage yet." />
                </div>
              )}
              <div className="flex flex-col gap-2">
                <h4 className="font-mono text-[11px] tracking-wider text-faint uppercase">Calls (newest first)</h4>
                {lanes.map((l) => (
                  <LaneCalls key={l.id} source={s.source} id={s.id} lane={l.id} live={s.live} />
                ))}
              </div>
            </ScrollArea>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
