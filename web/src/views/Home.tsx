import { useMemo } from "react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StageBar } from "@/components/StageBar"
import { ItemTable } from "@/components/ItemTable"
import { LiveActivity } from "@/components/LiveActivity"
import { NeedsYouQueue } from "@/components/NeedsYouQueue"
import { useItems, useSources, type ItemSummary, type RunSummary } from "@/lib/api"
import { useNow } from "@/lib/format"
import { useShared } from "@/lib/projects-context"
import { isWaiting } from "@/lib/runs-context"
import { toHash } from "@/lib/route"
import { matchesFilter } from "@/lib/tree"

export function RunStatusBadge({ run }: { run: RunSummary }) {
  if (isWaiting(run)) return <Badge className="bg-needs-you/15 text-needs-you">Waiting on you</Badge>
  if (run.live) return <Badge className="bg-running/15 text-running">Live</Badge>
  return <Badge variant="outline">Ended</Badge>
}

export function RunCard({ run }: { run: RunSummary }) {
  return (
    <a href={toHash({ view: "run", id: run.id, tab: "map" })} className="block rounded-xl focus-visible:outline-2">
      <Card className="h-full transition-colors hover:bg-muted/40">
        <CardHeader>
          <CardTitle className="line-clamp-2 text-sm font-semibold">{run.idea || run.id}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <StageBar stages={run.stages} />
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-mono text-[11px] text-muted-foreground">{run.id}</span>
            <RunStatusBadge run={run} />
          </div>
        </CardContent>
      </Card>
    </a>
  )
}

const RECENT = 100
const DAY_MS = 24 * 3600 * 1000

/** Items that stopped or failed in the last day, newest first (the queue's Stopped list). */
export function recentlyStopped(items: ItemSummary[], now: number, max = 4): ItemSummary[] {
  return items
    .filter((i) => (i.status === "stopped" || i.status === "failed") && i.updatedAt && now - Date.parse(i.updatedAt) < DAY_MS)
    .slice(0, max)
}

function Panel({ title, count, aside, children }: { title: string; count?: number; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card">
      <div className="flex h-10 items-center justify-between gap-3 border-b px-4">
        <h2 className="text-sm font-medium">
          {title}
          {count !== undefined && <span className="ml-1.5 font-mono text-xs text-faint">{count}</span>}
        </h2>
        {aside}
      </div>
      <div className="p-2">{children}</div>
    </section>
  )
}

/**
 * Home (directions.html B): the needs-you queue on the left; live activity (what each live lane is
 * doing now) and recent runs and sessions on the right. Hidden projects stay out unless shown.
 */
export default function Home() {
  const { overview, filter, showHidden } = useShared()
  const sources = useSources()
  const recent = useItems({ all: showHidden, limit: RECENT })
  const now = useNow()
  const actions = useMemo(() => Object.fromEntries((sources.data ?? []).map((s) => [s.name, s.actions])), [sources.data])
  const items = recent.data ?? []
  const shown = useMemo(() => items.filter((i) => matchesFilter(i, filter)), [items, filter])
  const live = overview.data?.live ?? []

  return (
    <div className="-m-5 grid min-h-[calc(100%+2.5rem)] lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="border-b p-4 lg:border-r lg:border-b-0" aria-label="Needs you">
        {overview.error && !overview.data ? (
          <p className="text-xs text-failed">Could not load what needs you: {overview.error}</p>
        ) : (
          <NeedsYouQueue
            entries={overview.data?.needsYou ?? []}
            stopped={recentlyStopped(items, now)}
            actions={actions}
            onActed={overview.reload}
            now={now}
          />
        )}
      </aside>
      <div className="flex min-w-0 flex-col gap-5 p-5">
        <Panel
          title="Live now"
          aside={live.length > 0 && <span className="font-mono text-[11px] text-running">● {live.length} lane{live.length === 1 ? "" : "s"} working</span>}
        >
          <LiveActivity lanes={live} now={now} />
        </Panel>
        <Panel
          title="Recent"
          aside={
            <span className="font-mono text-[11px] text-faint">
              {filter ? `${shown.length} of ${items.length} · filtered by the status chip` : `latest ${items.length} runs and sessions`}
            </span>
          }
        >
          {recent.error && !recent.data ? (
            <p className="px-2 py-4 text-xs text-failed">Could not load runs and sessions: {recent.error}</p>
          ) : recent.loading && !recent.data ? (
            <p className="px-2 py-4 text-xs text-faint">loading…</p>
          ) : (
            <ItemTable
              items={shown}
              cap={50}
              now={now}
              empty={filter ? "Nothing recent matches the status filter" : "No runs or sessions yet. Start a Claude Code session or pass --runs <dir>."}
            />
          )}
        </Panel>
      </div>
    </div>
  )
}
