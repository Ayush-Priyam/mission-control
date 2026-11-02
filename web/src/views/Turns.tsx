import { useMemo, useState } from "react"
import { Scissors } from "lucide-react"
import type { Lane } from "@/lib/api"
import { useTurnCosts, type TurnCost } from "@/lib/api-v22"
import { compact, money } from "@/lib/format"
import { Retry } from "@/components/Retry"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

export type TurnSort = "order" | "cost"

/** Turns in file order, or most expensive first. */
export function sortTurns(turns: TurnCost[], by: TurnSort): TurnCost[] {
  return by === "cost" ? [...turns].sort((a, b) => b.cost - a.cost || a.i - b.i) : turns
}

const time = (ts: string | null) => (ts ? new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "–")

/** Per-turn tokens and estimated cost of one lane, with compaction markers and a "why" hint. */
export default function Turns({ source, id, lanes, live }: { source: string; id: string; lanes: Lane[]; live: boolean }) {
  const [lane, setLane] = useState("main")
  const [by, setBy] = useState<TurnSort>("order")
  const r = useTurnCosts(source, id, lane, live ? 10_000 : 0)
  const rows = useMemo(() => sortTurns(r.data?.turns ?? [], by), [r.data, by])
  const max = Math.max(...rows.map((t) => t.cost), 0)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {lanes.length > 1 && (
          <label className="flex items-center gap-2 text-muted-foreground">
            Lane
            <select aria-label="Lane" value={lane} onChange={(e) => setLane(e.target.value)} className="h-7 rounded-md border bg-card px-2 text-foreground">
              {lanes.map((l) => (
                <option key={l.id} value={l.id}>{l.label}</option>
              ))}
            </select>
          </label>
        )}
        <div role="tablist" aria-label="Sort turns" className="flex rounded-md border p-0.5 font-mono">
          {(["order", "cost"] as const).map((b) => (
            <button key={b} role="tab" aria-selected={by === b} onClick={() => setBy(b)} className={cn("h-6 rounded px-2 text-muted-foreground hover:text-foreground", by === b && "bg-accent text-foreground")}>
              {b === "order" ? "in order" : "by cost"}
            </button>
          ))}
        </div>
        {r.data && (
          <span className="ml-auto font-mono text-muted-foreground">
            {r.data.total.turns} turns · {money(r.data.total.cost)} est.{r.data.total.compactions ? ` · ${r.data.total.compactions} compaction${r.data.total.compactions === 1 ? "" : "s"}` : ""}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Context = input + cache read + cache write. A large cache write means new context was sent; a high cache read means a long context is re-read every turn. Costs are list-price estimates.
      </p>
      {r.error && !r.data ? (
        <div role="alert" className="flex items-center gap-3 text-sm text-failed">Could not load turns ({r.error}).<Retry onRetry={r.reload} /></div>
      ) : !r.data ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No assistant turns with token usage in this lane.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[720px] text-xs" aria-label="Turns">
            <thead className="text-left text-muted-foreground">
              <tr className="border-b">
                <th className="px-3 py-2 font-normal">#</th>
                <th className="px-3 py-2 font-normal">time</th>
                <th className="px-3 py-2 text-right font-normal">input</th>
                <th className="px-3 py-2 text-right font-normal">cache read</th>
                <th className="px-3 py-2 text-right font-normal">cache write</th>
                <th className="px-3 py-2 text-right font-normal">output</th>
                <th className="px-3 py-2 text-right font-normal">context</th>
                <th className="px-3 py-2 text-right font-normal">est. cost</th>
                <th className="px-3 py-2 font-normal">why</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {rows.map((t) => (
                <TurnRow key={t.i} t={t} max={max} marker={by === "order" && t.compacted} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function TurnRow({ t, max, marker }: { t: TurnCost; max: number; marker: boolean }) {
  return (
    <>
      {marker && (
        <tr data-compaction className="border-b bg-consult/10 text-consult">
          <td colSpan={9} className="px-3 py-1">
            <span className="inline-flex items-center gap-1.5 font-sans"><Scissors className="size-3.5" /> context dropped sharply here (compaction or a cleared context)</span>
          </td>
        </tr>
      )}
      <tr data-turn className="border-b last:border-0" title={t.model ?? undefined}>
        <td className="px-3 py-1.5 text-faint">{t.i + 1}</td>
        <td className="px-3 py-1.5 text-muted-foreground">{time(t.ts)}</td>
        <td className="px-3 py-1.5 text-right">{compact(t.in)}</td>
        <td className="px-3 py-1.5 text-right">{compact(t.cacheRead)}</td>
        <td className="px-3 py-1.5 text-right">{compact(t.cacheWrite)}</td>
        <td className="px-3 py-1.5 text-right">{compact(t.out)}</td>
        <td className="px-3 py-1.5 text-right">{compact(t.context)}</td>
        <td className="px-3 py-1.5 text-right">
          <span className="inline-flex items-center justify-end gap-2">
            <i aria-hidden className="block h-1.5 rounded-full bg-llm/70" style={{ width: `${max ? Math.max(2, (t.cost / max) * 48) : 0}px` }} />
            {money(t.cost)}
          </span>
        </td>
        <td className="px-3 py-1.5 font-sans text-muted-foreground">{t.why ?? ""}</td>
      </tr>
    </>
  )
}
