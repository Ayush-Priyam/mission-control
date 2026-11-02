import { useEffect, useMemo, useRef, useState } from "react"
import { Heatmap } from "@/components/Heatmap"
import { slices, SplitBar } from "@/components/SplitBar"
import { TrendBars } from "@/components/TrendBars"
import { UsageTable, type UsageRowView } from "@/components/UsageTable"
import { UsageTotals } from "@/components/UsageTotals"
import { Skeleton } from "@/components/ui/skeleton"
import {
  browserTz, compact, fillSeries, money, pct, rangeDates, RANGES, shiftDay, todayIn, totalTokens, trendWindow, usageUrl, useUsage,
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
const baseName = (p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p

/** A group as a table row; worktrees show their folder name with the full path under it. */
function groupRow(g: Group, by: TableTab): UsageRowView {
  if (by === "worktree" && g.key !== "(none)") return { ...g, label: baseName(g.key), sub: g.key }
  return { ...g, label: g.name ?? g.key }
}

/** Usage across every source: TokenTracker layout over /api/usage, days in the viewer's zone. */
export function Usage({ initialRange = "month", initialTable = "day" }: { initialRange?: Range; initialTable?: TableTab } = {}) {
  const tz = browserTz()
  const today = todayIn(tz)
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
  // keep the last answer on screen while a new range loads, so the page does not blank
  const lastMain = useRef<UsageData | null>(null)
  if (main.data) lastMain.current = main.data
  const mainData = main.data ?? lastMain.current

  const trend = useMemo(() => {
    const w = trendWindow(range, today, mainData?.series ?? [])
    const src = range === "all" ? mainData?.series : half.data?.series
    return src ? fillSeries(src, w.from, w.to) : []
  }, [range, today, mainData, half.data])

  const error = main.error ?? harness.error ?? half.error
  if (!mainData && main.loading) return <UsageSkeleton />
  if (!mainData) return <p className="p-6 font-mono text-xs text-failed">Usage not available ({error ?? "no data"}).</p>

  const u = mainData
  const splitGroups = splitBy === "model" ? u.groups : (harness.data?.groups ?? [])
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
      <aside className="flex min-w-0 flex-col gap-5">
        <section aria-label="Quick stats" className={cn(card, "flex flex-col gap-4")}>
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
        </section>
        <div className={card}>
          <Heatmap series={halfSeries} today={today} tz={tz} />
        </div>
        <div className={card}>
          <TrendBars days={trend} />
        </div>
      </aside>

      <main className="flex min-w-0 flex-col gap-5">
        <section className={cn(card, "flex flex-col gap-5")}>
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
              <span>{dates.from ? (dates.from === dates.to ? dates.to : `${dates.from} → ${dates.to}`) : `→ ${dates.to}`}</span>
            </div>
          </div>
          <UsageTotals totals={u.totals} label={RANGE_LABEL[range]} />
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] tracking-widest text-muted-foreground">SPLIT BY</span>
              <div role="tablist" aria-label="Split by" className="flex gap-1 font-mono text-[11px]">
                {(["model", "harness"] as const).map((b) => (
                  <button key={b} role="tab" aria-selected={splitBy === b} onClick={() => setSplitBy(b)}
                    className={cn("rounded px-2 py-0.5 text-muted-foreground hover:text-foreground", splitBy === b && "bg-muted text-foreground")}>
                    {b}
                  </button>
                ))}
              </div>
            </div>
            <SplitBar groups={splitBy === "harness" ? splitGroups.map((g) => ({ ...g, name: harnessName(g.key) })) : splitGroups} label={splitBy} />
          </div>
          <div aria-label="Harnesses" className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
            {harnessSlices.length === 0 && <p className="font-mono text-xs text-muted-foreground">No harness reported usage in this range.</p>}
            {harnessSlices.map((s) => (
              <div key={s.key} className="rounded-lg border bg-background/40 p-3">
                <div className="flex items-center gap-2 text-[13px] font-semibold tracking-wide uppercase">
                  <i className="inline-block size-2 rounded-full" style={{ background: s.color }} />
                  {s.key === "(other)" ? s.label : harnessName(s.key)}
                </div>
                <div className="mt-1 font-mono text-xl font-bold">{pct(s.tokens, harnessTotal)}</div>
                <div className="font-mono text-[11px] text-muted-foreground">
                  {compact(s.tokens)} · {money(s.cost)} · {s.sessions} sessions
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className={cn(card, "flex flex-col gap-3 p-3 sm:p-5")}>
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
            <UsageTable key={table} rows={tableRows} nameLabel={tableMeta.name} defaultSort={table === "day" ? "name" : "cost"} />
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
