import type { LoopingItem } from "@/lib/api"
import { loopLine } from "@/lib/format"
import { toHash } from "@/lib/route"
import { StatusDot } from "@/components/StatusDot"

/**
 * Home, under Needs you: items retrying the same failure (src/loops.mjs). Each row links to the first
 * failing call on the item's Calls tab, and says how long, how often and what it cost since.
 */
export function LoopingList({ entries, now }: { entries: LoopingItem[]; now: number }) {
  if (!entries.length) return null
  return (
    <section aria-label="Looping" className="flex flex-col gap-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <StatusDot status="looping" labelled />
        <span>Looping</span>
        <span className="font-mono text-xs text-looping">{entries.length}</span>
      </h3>
      {entries.map((e) => (
        <article key={`${e.source}/${e.id}`} className="rounded-xl border border-looping/40 bg-card p-3">
          <div className="truncate text-xs text-faint">{[e.project?.name, e.lane].filter(Boolean).join(" · ")}</div>
          <a href={toHash({ view: "item", source: e.source, id: e.id, tab: "calls", call: e.loop.firstCallId })} className="mt-0.5 line-clamp-2 block text-sm hover:underline">
            {e.title || e.id}
          </a>
          <p className="mt-1 font-mono text-xs text-looping" title={e.loop.command}>{loopLine(e.loop, now)}</p>
        </article>
      ))}
    </section>
  )
}
