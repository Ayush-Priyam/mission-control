import { useExtra } from "@/lib/api"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

type Tok = { input: number; output: number; cache_creation: number; cache_read: number; billable: number }
type Tokens = { available: boolean; total: Tok; sessions: { session: string; first: string; last: string; tokens: Tok }[] }

export const human = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n ?? 0))

const ROWS: { k: string; tip: string; v: (t: Tok) => string }[] = [
  { k: "Billable", tip: "input + output + cache-write, summed across sessions. Cache-read is excluded: it is much cheaper and would dwarf the total. A proxy for paid work, not dollars.", v: (t) => human(t.billable) },
  { k: "Input · Output", tip: "Input is fresh (uncached) tokens sent to the model; output is what the model generated.", v: (t) => `${human(t.input)} · ${human(t.output)}` },
  { k: "Cache write", tip: "Tokens written into the prompt cache so stable context is not re-billed every turn. Counted in Billable.", v: (t) => human(t.cache_creation) },
  { k: "Cache read", tip: "Tokens served from cache on later turns. Excluded from Billable.", v: (t) => `${human(t.cache_read)} · excluded` },
]

/** Token spend for this project, summed from its Claude Code session logs. `optional`: draw nothing
 * until the run's tokens extra answers 200 (the native adapter 404s runs that log their own sessions). */
export function TokenPanel({ runId, optional = false }: { runId: string; optional?: boolean }) {
  const r = useExtra<Tokens>("tokens", runId)
  if (optional && !r.data) return null
  if (r.loading && !r.data) return <Skeleton className="h-24 w-full" />
  if (!r.data) return <p className="font-mono text-xs text-failed">Tokens not available ({r.error ?? "none"}).</p>
  const t = r.data
  return (
    <TooltipProvider delay={150}>
      <section aria-label="Token spend" className="flex flex-col gap-2 rounded-xl border bg-card p-4">
        <h3 className="font-mono text-xs tracking-widest text-muted-foreground">TOKEN SPEND · THIS PROJECT</h3>
        {!t.available ? (
          <p className="font-mono text-xs text-muted-foreground">No Claude Code session logs found for this project.</p>
        ) : (
          <dl className="flex flex-col text-body">
            {ROWS.map((row) => (
              <div key={row.k} className="flex justify-between gap-4 border-b py-1 last:border-0">
                <Tooltip>
                  <TooltipTrigger render={<dt className="cursor-help text-muted-foreground" />}>{row.k}</TooltipTrigger>
                  <TooltipContent className="max-w-64">{row.tip}</TooltipContent>
                </Tooltip>
                <dd className="font-mono">{row.v(t.total)}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-4 py-1"><dt className="text-muted-foreground">Sessions</dt><dd className="font-mono">{t.sessions.length}</dd></div>
          </dl>
        )}
      </section>
    </TooltipProvider>
  )
}
