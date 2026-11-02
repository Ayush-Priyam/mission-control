import { Hourglass } from "lucide-react"
import type { UsageWindow } from "@/lib/api-v22"
import { compact, money } from "@/lib/format"
import { cn } from "@/lib/utils"

const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "–")

/**
 * Claude Code's current rolling usage window, estimated from local logs. Always labelled as an estimate;
 * the window length and limit are the owner's settings, never Anthropic's actual limits.
 */
export function UsageWindowCard({ w }: { w: UsageWindow }) {
  if (!w.available) return null
  const share = w.limit?.tokens ? w.used.tokens / w.limit.tokens : w.limit?.usd ? w.used.cost / w.limit.usd : null
  return (
    <section aria-label="Usage window" className="rounded-xl border bg-card px-4 py-3 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-1.5 text-sm font-medium"><Hourglass className="size-3.5 text-muted-foreground" /> Usage window</span>
        <span className="rounded border px-1.5 py-0.5 font-mono text-faint">estimate · Claude Code · {w.hours} h window</span>
        <span data-window-message className={cn("font-medium", w.hitsBeforeReset || (w.eta === 0 && w.active) ? "text-failed" : "text-foreground")}>{w.message}</span>
      </div>
      {w.active && (
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 font-mono text-muted-foreground">
          <span>since {clock(w.start)} · resets ~{clock(w.resetsAt)}</span>
          <span>{compact(Math.round(w.used.tokens))} tokens · {money(w.used.cost)} est.</span>
          <span>{compact(Math.round(w.rate.tokensPerHour))}/h</span>
          {w.limit && <span>limit {w.limit.tokens ? `${compact(w.limit.tokens)} tokens` : ""}{w.limit.tokens && w.limit.usd ? " · " : ""}{w.limit.usd ? money(w.limit.usd) : ""}</span>}
        </div>
      )}
      {share !== null && w.active && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" role="meter" aria-label="Window used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(1, share) * 100)}>
          <i className={cn("block h-full rounded-full", share >= 1 ? "bg-failed" : share >= 0.8 ? "bg-consult" : "bg-running")} style={{ width: `${Math.min(1, share) * 100}%` }} />
        </div>
      )}
      <p className="mt-2 text-faint">
        From your local logs only (input + output + cache write tokens). Anthropic's real window and limits are not public and are not read here; set your own in config.json <span className="font-mono">usageWindow</span>.
      </p>
    </section>
  )
}
