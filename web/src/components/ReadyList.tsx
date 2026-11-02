import type { ReadyItem } from "@/lib/api"
import { ago } from "@/lib/format"
import { toHash } from "@/lib/route"

/**
 * Home, under Needs you: sessions that finished and wait for your next prompt. Collapsed by default and
 * in the calm info tone: they are findable, not urgent.
 */
export function ReadyList({ entries, now }: { entries: ReadyItem[]; now: number }) {
  if (!entries.length) return null
  return (
    <details className="group rounded-xl border border-consult/30 bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm marker:hidden [&::-webkit-details-marker]:hidden">
        <i aria-hidden className="mc-dot inline-block size-2 shrink-0 rounded-full bg-consult not-italic" />
        <span>Ready</span>
        <span className="font-mono text-xs text-consult">{entries.length}</span>
        <span className="ml-auto text-xs text-faint group-open:hidden">waiting for your next prompt</span>
      </summary>
      <ul className="flex flex-col gap-1 border-t px-3 py-2">
        {entries.map((r) => (
          <li key={`${r.source}/${r.id}`} className="flex min-w-0 items-baseline gap-2 text-xs">
            <a href={toHash({ view: "item", source: r.source, id: r.id, tab: "lanes" })} className="min-w-0 flex-1 truncate text-sm hover:underline">
              {r.title || r.id}
            </a>
            <span className="shrink-0 font-mono text-faint">ready {ago(r.since, now)}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}
