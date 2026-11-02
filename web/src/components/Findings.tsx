import { useState } from "react"
import type { Finding } from "@/lib/item"
import { cn } from "@/lib/utils"

const DOT = { failed: "bg-failed", consult: "bg-consult", "needs-you": "bg-needs-you" }
const LIMIT = 8

/** Errors, send-backs and questions, newest first; click one to open its lane. */
export function Findings({ items, onOpen }: { items: Finding[]; onOpen?: (lane: string) => void }) {
  const [all, setAll] = useState(false)
  const list = [...items].reverse()
  const shown = all ? list : list.slice(0, LIMIT)
  return (
    <section aria-label="Findings" className="flex flex-col gap-2 rounded-xl border bg-card p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">Findings</h3>
        {items.length > 0 && <span className="font-mono text-xs text-faint">{items.length}</span>}
      </div>
      {!items.length ? (
        <p className="text-body text-muted-foreground">No errors, send-backs or questions.</p>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {shown.map((f, i) => (
            <li key={i}>
              <button
                type="button"
                disabled={!f.lane || !onOpen}
                onClick={() => f.lane && onOpen?.(f.lane)}
                className="flex w-full items-start gap-2 text-left text-body leading-snug enabled:hover:text-foreground"
              >
                <i className={cn("mt-1.5 inline-block size-2 shrink-0 rounded-full", DOT[f.tone])} />
                <span className="line-clamp-2 min-w-0" title={f.text}>{f.text}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {list.length > LIMIT && (
        <button type="button" onClick={() => setAll((a) => !a)} className="self-start font-mono text-xs text-muted-foreground hover:text-foreground">
          {all ? "show fewer" : `show all ${list.length}`}
        </button>
      )}
    </section>
  )
}
