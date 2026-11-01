import { cn } from "@/lib/utils"
import { eventLine, hhmm, TONE_CLASS } from "@/lib/events"
import { sessionFile } from "@/lib/transcript"

type Ev = Record<string, any>

/** A stage's events and sessions in order, one timestamped line each (the old page's console log).
 * With `onSession`, a session line that has a transcript is a button that opens it. */
export function StageLog({ events, empty = "Nothing yet.", onSession }: { events: Ev[]; empty?: string; onSession?: (name: string) => void }) {
  if (!events.length) return <p className="font-mono text-xs text-muted-foreground">{empty}</p>
  return (
    <ol className="flex flex-col gap-1 font-mono text-xs">
      {events.map((e, i) => {
        const { who, text, tone } = eventLine(e)
        const file = e.type === "session" && onSession ? sessionFile(e.transcript) : null
        const line = (
          <>
            <b className="font-bold text-foreground">{who}</b> {text}
          </>
        )
        return (
          <li key={i} className={cn("grid grid-cols-[3.25rem_1fr] gap-2", e.type === "session" && "rounded bg-muted/40 py-0.5")}>
            <span className="text-muted-foreground">{hhmm(e.ts)}</span>
            {file ? (
              <button
                type="button"
                onClick={() => onSession!(file)}
                className={cn("min-w-0 cursor-pointer break-words text-left underline-offset-2 hover:underline", TONE_CLASS[tone])}
                title="Open the transcript"
              >
                {line} <span className="text-llm">↗ transcript</span>
              </button>
            ) : (
              <span className={cn("min-w-0 break-words", TONE_CLASS[tone])}>{line}</span>
            )}
          </li>
        )
      })}
    </ol>
  )
}
