import type { Call, ItemDetail } from "@/lib/api"
import { findings, health, openStopOf } from "@/lib/item"
import { Findings } from "@/components/Findings"
import { HealthCard } from "@/components/HealthCard"
import { NeedsYouCard, type Ask } from "@/components/NeedsYouCard"

/** What the needs-you card shows: a run's open stop, else a lane that waits on you (a hook-reported session). */
export function askOf(d: ItemDetail): Ask | null {
  const stop = openStopOf(d)
  if (stop) return { waiting: stop.waiting, lane: stop.stage, rule: stop.rule, detail: stop.detail, ts: stop.ts }
  const w = d.lanes.find((l) => l.status === "waiting")
  if (w || d.summary.waiting) return { waiting: true, lane: w?.label, detail: w?.reason, ts: d.summary.updatedAt ?? undefined }
  return null
}

/** The item's right rail: needs-you (or stopped), health, findings. */
export function RightRail({ detail, calls, actions, now, onActed, onOpen }: { detail: ItemDetail; calls: Call[] | null; actions: string[]; now: number; onActed?: () => void; onOpen?: (lane: string) => void }) {
  const ask = askOf(detail)
  return (
    <aside className="flex flex-col gap-4" aria-label="Item rail">
      {ask && <NeedsYouCard key={`${ask.lane}|${ask.ts}`} source={detail.summary.source} id={detail.summary.id} ask={ask} actions={actions} now={now} onActed={onActed} />}
      <HealthCard h={health(detail, calls)} />
      <Findings items={findings(detail, calls ?? [])} onOpen={onOpen} />
    </aside>
  )
}
