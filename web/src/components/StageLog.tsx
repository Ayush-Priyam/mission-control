import { cn } from "@/lib/utils"
import { eventLine, hhmm, TONE_CLASS } from "@/lib/events"

type Ev = Record<string, any>

/** A stage's events and sessions in order, one timestamped line each (the old page's console log). */
export function StageLog({ events, empty = "Nothing yet." }: { events: Ev[]; empty?: string }) {
  if (!events.length) return <p className="font-mono text-xs text-muted-foreground">{empty}</p>
  return (
    <ol className="flex flex-col gap-1 font-mono text-xs">
      {events.map((e, i) => {
        const { who, text, tone } = eventLine(e)
        return (
          <li key={i} className={cn("grid grid-cols-[3.25rem_1fr] gap-2", e.type === "session" && "rounded bg-muted/40 py-0.5")}>
            <span className="text-muted-foreground">{hhmm(e.ts)}</span>
            <span className={cn("min-w-0 break-words", TONE_CLASS[tone])}>
              <b className="font-bold text-foreground">{who}</b> {text}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
