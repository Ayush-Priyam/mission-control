import { useEffect, useMemo, useState } from "react"
import { Heatmap } from "@/components/Heatmap"
import { slices, SplitBar } from "@/components/SplitBar"
import { TrendBars } from "@/components/TrendBars"
import { UsageTable, type UsageRowView } from "@/components/UsageTable"
import { UsageTotals } from "@/components/UsageTotals"
import { Skeleton } from "@/components/ui/skeleton"
import {
  browserTz, compact, EST_TIP, estMoney, fillSeries, pct, rangeDates, RANGES, shiftDay, totalTokens, trendWindow, usageUrl, useToday, useUsage,
  type By, type Group, type Range, type SeriesDay, type Usage as UsageData,
} from "@/lib/usage-api"
import { cn } from "@/lib/utils"

export type TableTab = "day" | "project" | "worktree" | "branch"
const TABLES: { id: TableTab; label: string; name: string }[] = [
  { id: "day", label: "Daily breakdown", name: "Date" },
  { id: "project", label: "Projects", name: "Project" },
  { id: "worktree", label: "Worktrees", name: "Worktree" },
  { id: "branch", label: "Branches", name: "Branch" },
]
const HARNESS_NAMES: Record<string, string> = { "claude-code": "Claude Code", ronin: "Ronin", codex: "Codex", "spec-kit": "Spec Kit" }
const harnessName = (k: string) => HARNESS_NAMES[k] ?? k
const RANGE_LABEL: Record<Range, string> = { day: "today", week: "last 7 days", month: "last 30 days", all: "all time" }
const POLL_WHILE_SCANNING = 3000
const HEAT_DAYS = 26 * 7

const card = "rounded-xl border bg-card p-5"
const sum = (days: SeriesDay[]) => days.reduce((a, d) => a + totalTokens(d), 0)
/** The days an answer covers, from the answer itself (so a kept answer never borrows the new range's dates). */
const spanOf = (u: UsageData) => (u.from ? (u.from === u.to ? `${u.to}` : `${u.from} → ${u.to}`) : `all → ${u.to ?? ""}`)
const busy = (on: boolean) => (on ? { "aria-busy": true, className: "opacity-50 transition-opacity" } : { className: "transition-opacity" })
const busyIn = (on: boolean, cls: string) => ({ ...(on ? { "aria-busy": true } : {}), className: cn(cls, "transition-opacity", on && "opacity-50") })
const baseName = (p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p

/** A group as a table row; worktrees show their folder name with the full path under it. */
function groupRow(g: Group, by: TableTab): UsageRowView {
  if (by === "worktree" && g.key !== "(none)") return { ...g, label: baseName(g.key), sub: g.key }
  return { ...g, label: g.name ?? g.key }
}

/** Usage across every source: TokenTracker layout over /api/usage, days in the viewer's zone. */
export function Usage({ initialRange = "month", initialTable = "day" }: { initialRange?: Range; initialTable?: TableTab } = {}) {
  const tz = browserTz()
  const today = useToday(tz)
  const [range, setRange] = useState<Range>(initialRange)
  const [splitBy, setSplitBy] = useState<"model" | "harness">("model")
  const [table, setTable] = useState<TableTab>(initialTable)
  const [scanning, setScanning] = useState(false)
  const poll = scanning ? POLL_WHILE_SCANNING : 0

  const dates = rangeDates(range, today)
  const url = (by: By, d: { from?: string; to?: string } = dates) => usageUrl({ by, tz, ...d })
  const main = useUsage(url("model"), poll)
  const harness = useUsage(url("harness"), poll)
  const half = useUsage(url("harness", { from: shiftDay(today, -(HEAT_DAYS - 1)), to: today }), poll)
  const grouped = useUsage(table === "day" ? null : url(table), poll)

  const partial = [main, harness, half].some((r) => r.data && !r.data.complete)
  useEffect(() => setScanning(partial), [partial])
  const mainData = main.data

  const trend = useMemo(() => {
    const w = trendWindow(range, today, mainData?.series ?? [])
    const src = range === "all" ? mainData?.series : half.data?.series
    return src ? fillSeries(src, w.from, w.to) : []
  }, [range, today, mainData, half.data])

  const errors = [main.error, harness.error, half.error, grouped.error].filter((e): e is string => !!e)
  if (!mainData && main.loading) return <UsageSkeleton />
  if (!mainData) return <p role="alert" className="p-6 font-mono text-xs text-failed">Usage not available ({errors[0] ?? "no data"}).</p>

  const u = mainData
  const split = splitBy === "model" ? main : harness
  const splitGroups = split.data?.groups ?? []
  const harnessSlices = slices(harness.data?.groups ?? [])
  const harnessTotal = harnessSlices.reduce((a, s) => a + s.tokens, 0)
  const halfSeries = half.data?.series ?? []
  const last = (n: number) => fillSeries(halfSeries, shiftDay(today, -(n - 1)), today)
  const active = halfSeries.filter((d) => totalTokens(d) > 0)
  const topModels = slices(u.groups, 3).filter((s) => s.key !== "(other)")
  const modelTotal = totalTokens(u.totals)
  const firstDay = (range === "all" ? u.series : halfSeries)[0]?.day

  const dailyRows: UsageRowView[] = [...u.series].reverse().map((d) => ({ ...d, key: d.day, label: d.day }))
  const tableRows = table === "day" ? dailyRows : (grouped.data?.groups ?? []).map((g) => groupRow(g, table))
  const tableMeta = TABLES.find((t) => t.id === table)!

  return (
    <div className="mx-auto grid w-full max-w-[1400px] grid-cols-1 gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(300px,380px)_1fr]">
      {errors.length > 0 && (
        <p role="alert" className="rounded-lg border border-[#ef4444]/40 bg-[#ef4444]/10 px-4 py-2 font-mono text-xs text-[#ef4444] lg:col-span-2">
          Usage request failed: {[...new Set(errors)].join(" · ")}
          {main.stale || harness.stale || half.stale ? " (showing the last answer)" : ""}
        </p>
      )}
      <aside className="flex min-w-0 flex-col gap-5">
        <section aria-label="Quick stats" {...busy(half.stale || main.stale)} >
         <div className={cn(card, "flex flex-col gap-4")}>
          <div className="grid grid-cols-4 gap-2">
            {[
              [compact(sum(last(7))), "7d"],
              [compact(sum(last(30))), "30d"],
              [compact(active.length ? sum(active) / active.length : 0), "avg / day"],
              [compact(u.totals.sessions), "sessions"],
            ].map(([v, k]) => (
              <div key={k} className="rounded-lg bg-muted/50 px-2 py-2.5 text-center">
                <div className="font-mono text-sm font-bold">{v}</div>
                <div className="font-mono text-[10px] text-muted-foreground">{k}</div>
              </div>
            ))}
          </div>
          <ol className="flex flex-col gap-2 border-t pt-3 text-[13px]">
            {topModels.length === 0 && <li className="font-mono text-xs text-muted-foreground">No models used in this range.</li>}
            {topModels.map((m, i) => (
              <li key={m.key} className="flex items-center gap-3">
                <span className="grid size-5 place-items-center rounded-full bg-muted font-mono text-[10px] text-muted-foreground">{i + 1}</span>
                <span className="flex-1 truncate">{m.label}</span>
                <span className="font-mono">{pct(m.tokens, modelTotal)}</span>
              </li>
            ))}
          </ol>
          <div className="flex justify-between border-t pt-3 font-mono text-[11px] text-muted-foreground">
            <span>Since {firstDay ?? "–"}</span>
            <span>Active days {active.length}</span>
          </div>
         </div>
        </section>
        <div {...busy(half.stale)}>
          <div className={card}>{half.data ? <Heatmap series={halfSeries} today={today} tz={tz} /> : <Skeleton className="h-40" />}</div>
        </div>
        <div {...busy(range === "all" ? main.stale : half.stale)}>
          <div className={card}><TrendBars days={trend} /></div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-col gap-5">
        <section aria-label="Range summary" className={cn(card, "flex flex-col gap-5")}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="tablist" aria-label="Range" className="flex gap-1">
              {RANGES.map((r) => (
                <button key={r.id} role="tab" aria-selected={range === r.id} onClick={() => setRange(r.id)}
                  className={cn("rounded-md border border-transparent px-3 py-1 font-mono text-xs tracking-wider text-muted-foreground uppercase hover:text-foreground",
                    range === r.id && "border-[#60a5fa] text-foreground")}>
                  {r.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3 font-mono text-[11px] text-muted-foreground">
              {scanning && <span className="text-[#f59e0b]">scanning logs · partial</span>}
              {main.stale && <span>loading…</span>}
              <span>{spanOf(u)}</span>
            </div>
          </div>
          <div aria-label="Totals" {...busy(main.stale)}>
            <UsageTotals totals={u.totals} label={main.stale ? spanOf(u) : RANGE_LABEL[range]} />
          </div>
          <div aria-label="Split" {...busyIn(split.stale, "flex flex-col gap-2")}>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] tracking-widest text-muted-foreground">
                SPLIT BY{split.stale && split.data ? ` · ${spanOf(split.data)} · loading…` : ""}
              </span>
              <div role="tablist" aria-label="Split by" className="flex gap-1 font-mono text-[11px]">
                {(["model", "harness"] as const).map((b) => (
                  <button key={b} role="tab" aria-selected={splitBy === b} onClick={() => setSplitBy(b)}
                    className={cn("rounded px-2 py-0.5 text-muted-foreground hover:text-foreground", splitBy === b && "bg-muted text-foreground")}>
                    {b}
                  </button>
                ))}
              </div>
            </div>
            {split.data ? (
              <SplitBar groups={splitBy === "harness" ? splitGroups.map((g) => ({ ...g, name: harnessName(g.key) })) : splitGroups} label={splitBy} />
            ) : (
              <Skeleton className="h-6" />
            )}
          </div>
          <div aria-label="Harnesses" {...busyIn(harness.stale, "flex flex-col gap-2")}>
           {harness.stale && harness.data && (
             <span className="font-mono text-[11px] text-muted-foreground">Harnesses · {spanOf(harness.data)} · loading…</span>
           )}
           <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
            {!harness.data && <Skeleton className="h-20" />}
            {harness.data && harnessSlices.length === 0 && <p className="font-mono text-xs text-muted-foreground">No harness reported usage in this range.</p>}
            {harnessSlices.map((s) => (
              <div key={s.key} className="rounded-lg border bg-background/40 p-3">
                <div className="flex items-center gap-2 text-[13px] font-semibold tracking-wide uppercase">
                  <i className="inline-block size-2 rounded-full" style={{ background: s.color }} />
                  {s.key === "(other)" ? s.label : harnessName(s.key)}
                </div>
                <div className="mt-1 font-mono text-xl font-bold">{pct(s.tokens, harnessTotal)}</div>
                <div className="font-mono text-[11px] text-muted-foreground">
                  {compact(s.tokens)} · <span title={EST_TIP}>{estMoney(s.cost)}</span> · {s.sessions} sessions
                </div>
              </div>
            ))}
           </div>
          </div>
        </section>

        <section className={cn(card, "flex flex-col gap-3 p-3 sm:p-5")} {...(main.stale || grouped.stale ? { "aria-busy": true } : {})}>
          <div role="tablist" aria-label="Breakdown" className="flex flex-wrap gap-1">
            {TABLES.map((t) => (
              <button key={t.id} role="tab" aria-selected={table === t.id} onClick={() => setTable(t.id)}
                className={cn("rounded-md px-3 py-1.5 text-[13px] text-muted-foreground hover:text-foreground", table === t.id && "bg-muted text-foreground")}>
                {t.label}
              </button>
            ))}
          </div>
          {table !== "day" && !grouped.data ? (
            grouped.error ? <p className="font-mono text-xs text-failed">{grouped.error}</p> : <Skeleton className="h-40 w-full" />
          ) : (
            <div className={cn("transition-opacity", (table === "day" ? main.stale : grouped.stale) && "opacity-50")}>
              <UsageTable key={`${table}-${range}`} rows={tableRows} nameLabel={tableMeta.name} defaultSort={table === "day" ? "name" : "cost"} />
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

function UsageSkeleton() {
  return (
    <div className="mx-auto grid w-full max-w-[1400px] grid-cols-1 gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(300px,380px)_1fr]">
      <div className="flex flex-col gap-5">
        <Skeleton className="h-52" />
        <Skeleton className="h-52" />
      </div>
      <Skeleton className="h-96" />
    </div>
  )
}
