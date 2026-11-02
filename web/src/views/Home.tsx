import { workingLine } from "@/lib/status-ui"
import { Retry } from "@/components/Retry"
import { useMemo } from "react"
import { Panel } from "@/components/Panel"
import { ItemTable } from "@/components/ItemTable"
import { LiveActivity } from "@/components/LiveActivity"
import { NeedsYouQueue } from "@/components/NeedsYouQueue"
import { ReadyList } from "@/components/ReadyList"
import { useItems, useSources, type ItemSummary } from "@/lib/api"
import { useNow } from "@/lib/format"
import { useShared } from "@/lib/projects-context"
import { toHash } from "@/lib/route"
import { matchesFilter } from "@/lib/tree"

const RECENT = 100
const DAY_MS = 24 * 3600 * 1000

/** Items that stopped or failed in the last day, newest first (the queue's Stopped list). */
export function recentlyStopped(items: ItemSummary[], now: number, max = 4): ItemSummary[] {
  return items
    .filter((i) => (i.status === "stopped" || i.status === "failed") && i.updatedAt && now - Date.parse(i.updatedAt) < DAY_MS)
    .slice(0, max)
}

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
          <div className="flex flex-wrap items-center gap-2 text-xs text-failed"><span>Could not load what needs you: {overview.error}</span><Retry onRetry={overview.reload} /></div>
        ) : (
          <NeedsYouQueue
            entries={overview.data?.needsYou ?? []}
            stopped={recentlyStopped(items, now)}
            actions={actions}
            onActed={overview.reload}
            now={now}
          />
        )}
        {overview.data?.ready && overview.data.ready.length > 0 && (
          <div className="mt-3">
            <ReadyList entries={overview.data.ready} now={now} />
          </div>
        )}
      </aside>
      <div className="flex min-w-0 flex-col gap-5 p-5">
        <h1 className="sr-only">Home</h1>
        <Panel
          bodyClassName="p-2"
          title="Live now"
          aside={live.length > 0 && <span className="font-mono text-xs text-running">{workingLine(live)}</span>}
        >
          <LiveActivity lanes={live} now={now} />
        </Panel>
        <Panel
          bodyClassName="p-2"
          title="Recent"
          aside={
            <span className="font-mono text-xs text-faint">
              {filter ? `${shown.length} of ${items.length} · filtered by the status chip` : `latest ${items.length} runs and sessions`}
            </span>
          }
        >
          {recent.error && !recent.data ? (
            <div className="flex flex-wrap items-center gap-2 px-2 py-4 text-xs text-failed"><span>Could not load runs and sessions: {recent.error}</span><Retry onRetry={recent.reload} /></div>
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
