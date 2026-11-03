import { useState } from "react"
import { CircleDashed } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { useNow } from "@/lib/format"
import type { Entry } from "@/lib/remote"
import { cn } from "@/lib/utils"
import { PromptCard, type AnswerFn } from "./PromptCard"

const keyOf = (e: Entry) => `${e.source}/${e.id}`

/**
 * The Needs you list. `entries` null: first load (skeletons, `failed` stops their pulse).
 * A card whose identity (source + id) returns with a new promptId is flagged "new prompt" (C21) and starts fresh.
 */
export function PromptList({
  entries,
  online,
  answer,
  onAuth,
  failed = false,
}: {
  entries: Entry[] | null
  online: boolean
  answer: AnswerFn
  onAuth: (kind: "revoked" | "not-paired") => void
  failed?: boolean
}) {
  const now = useNow(10_000)
  // promptId last seen per card identity, and which identities were replaced since (derived while rendering).
  const [seen, setSeen] = useState<{ ids: Map<string, string>; flagged: Set<string>; from: Entry[] | null }>({ ids: new Map(), flagged: new Set(), from: null })
  if (entries && entries !== seen.from) {
    const ids = new Map<string, string>()
    const flagged = new Set<string>()
    for (const e of entries) {
      const k = keyOf(e)
      const before = seen.ids.get(k)
      if (e.promptId) ids.set(k, e.promptId)
      if (e.promptId && ((before && before !== e.promptId) || (seen.flagged.has(k) && before === e.promptId))) flagged.add(k)
    }
    setSeen({ ids, flagged, from: entries })
  }

  const list = entries ?? []
  const here = list.filter((e) => e.answerable).length
  const away = list.length - here

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 pt-4 pb-8">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <h1 className="text-[22px] leading-none font-semibold">Needs you</h1>
          {list.length > 0 && (
            <span aria-label={`${list.length} waiting`} className="rounded-full bg-needs-you/15 px-2 py-0.5 font-mono text-sm font-semibold text-needs-you">
              {list.length}
            </span>
          )}
          <span role="status" aria-label={online ? "live" : "not live"} className="ml-auto flex items-center gap-1.5 font-mono text-xs text-faint">
            <span data-live-dot className={cn("size-2 rounded-full", online ? "bg-running motion-safe:animate-pulse" : "bg-faint")} />
            live
          </span>
        </div>
        {list.length > 0 && (
          <p className="font-mono text-xs text-muted-foreground">
            {here} you can answer here · {away} at the terminal
          </p>
        )}
      </header>

      {entries === null && (
        <div aria-busy="true" className="flex flex-col gap-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} data-skeleton className={cn("h-40 rounded-xl", failed && "animate-none")} />
          ))}
        </div>
      )}

      {entries !== null && list.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <CircleDashed className="size-12 text-needs-you" aria-hidden />
          <p>Nothing needs you right now.</p>
        </div>
      )}

      {list.map((e) => (
        <PromptCard key={`${keyOf(e)}|${e.promptId ?? ""}`} entry={e} now={now} online={online} answer={answer} onAuth={onAuth} flagged={seen.flagged.has(keyOf(e))} />
      ))}
    </div>
  )
}
