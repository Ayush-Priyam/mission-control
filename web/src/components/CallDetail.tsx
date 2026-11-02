import { X } from "lucide-react"
import type { Call } from "@/lib/calls-api"
import { KIND, TONE, displayName, fmtDuration, fmtTime, outcome } from "@/components/CallList"
import { cn } from "@/lib/utils"

/** The transcript file a lane's calls come from (the names /session/:name accepts). */
export const sessionFile = (lane: string) => (lane === "main" ? "main.jsonl" : `${lane}.jsonl`)

const Label = ({ children }: { children: string }) => <div className="text-[11px] tracking-wide text-muted-foreground uppercase">{children}</div>
const Block = ({ children, tone }: { children: string; tone?: "error" }) => (
  <pre
    className={cn(
      "max-h-72 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs break-words whitespace-pre-wrap",
      tone === "error" ? "border-red-500/40 text-red-700 dark:text-red-300" : "text-foreground/85",
    )}
  >
    {children}
  </pre>
)

const btn = "inline-flex items-center rounded-md border px-3 py-1.5 text-xs hover:bg-muted"

type Props = {
  call: Call
  laneLabel: (lane: string) => string
  sessionHref: string
  timelineHref: string
  onClose: () => void
  /** Agent calls: jump to the sub-agent's lane. */
  onOpenLane?: (lane: string) => void
}

/** Right panel: one call's arguments, result, lane and links. */
export function CallDetail({ call, laneLabel, sessionHref, timelineHref, onClose, onOpenLane }: Props) {
  const k = KIND[call.kind]
  const o = outcome(call)
  const args = call.input === undefined ? null : typeof call.input === "string" ? call.input : JSON.stringify(call.input, null, 2)
  return (
    <div className="space-y-3 text-sm" aria-label="Call detail">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className={cn("font-mono break-all", k.text)}>{displayName(call)}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {laneLabel(call.lane)} · {fmtTime(call.ts)} · {fmtDuration(call.durationMs)}
          </div>
        </div>
        <button aria-label="Close" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <div className="text-muted-foreground">Type</div>
          <div>{k.type}</div>
        </div>
        <div>
          <div className="text-muted-foreground">{call.kind === "mcp" ? "Server" : "Tool"}</div>
          <div className="truncate">{call.kind === "mcp" ? call.server ?? "—" : call.kind === "skill" ? "Skill" : call.name}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Result</div>
          <div className={TONE[o.tone]}>{o.tone === "pending" ? "no result yet" : o.text}</div>
        </div>
      </div>
      <Label>Arguments</Label>
      {args === null ? <div className="text-xs text-muted-foreground">None recorded.</div> : <Block>{args}</Block>}
      <Label>{call.ok === false ? "Error" : "Result"}</Label>
      {call.ok === false ? (
        <Block tone="error">{call.error ?? "error"}</Block>
      ) : call.result ? (
        <Block>{call.result}</Block>
      ) : (
        <div className="text-xs text-muted-foreground">{call.ok === undefined ? "No result yet." : "No output."}</div>
      )}
      <Label>Context</Label>
      <div className="text-xs text-foreground/85">
        Lane <span className="font-medium">{laneLabel(call.lane)}</span> · in session <span className="font-mono underline">{sessionFile(call.lane)}</span>
        {call.subLane && (
          <>
            {" · ran as "}
            <button className="text-sky-600 underline dark:text-sky-300" onClick={() => onOpenLane?.(call.subLane!)}>
              {laneLabel(call.subLane)}
            </button>
          </>
        )}
      </div>
      <div className="flex gap-2 pt-2">
        <a className={btn} href={sessionHref}>Open session</a>
        <a className={btn} href={timelineHref}>Show on timeline</a>
      </div>
    </div>
  )
}
