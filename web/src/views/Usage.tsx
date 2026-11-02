import { useEffect, useMemo, useState } from "react"
import { Heatmap } from "@/components/Heatmap"
import { slices, SplitBar } from "@/components/SplitBar"
import { TrendBars } from "@/components/TrendBars"
import { UsageTable, type UsageRowView } from "@/components/UsageTable"
import { UsageTotals } from "@/components/UsageTotals"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Panel, Strip, StripCell } from "@/components/Panel"
import { reducedMotion } from "@/lib/media"
import { browserTz, usageUrl, useUsage } from "@/lib/api"
import {
  compact, EST_TIP, estMoney, fillSeries, pct, rangeDates, RANGES, shiftDay, totalTokens, trendWindow, useToday,
  type By, type Group, type Range, type SeriesDay, type Usage as UsageData,
} from "@/lib/usage"
import { cn } from "@/lib/utils"
import { BudgetBars } from "@/components/Budgets"
import { useBudgets, usePrUsage, type PrRow } from "@/lib/api-v22"

/** A PR as a table row: "#42 title", with project and branch under it. */
export const prRow = (r: PrRow): UsageRowView => ({ ...r, label: `#${r.pr.number} ${r.pr.title}`, sub: `${r.projectName} · ${r.branch}${r.pr.state ? ` · ${r.pr.state}` : ""}` })

export type TableTab = "day" | "project" | "worktree" | "branch" | "pr"
const TABLES: { id: TableTab; label: string; name: string }[] = [
  { id: "day", label: "Daily breakdown", name: "Date" },
  { id: "project", label: "Projects", name: "Project" },
  { id: "worktree", label: "Worktrees", name: "Worktree" },
  { id: "branch", label: "Branches", name: "Branch" },
  { id: "pr", label: "Pull requests", name: "Pull request" },
]
const HARNESS_NAMES: Record<string, string> = { "claude-code": "Claude Code", ronin: "Ronin", codex: "Codex", "spec-kit": "Spec Kit" }
const harnessName = (k: string) => HARNESS_NAMES[k] ?? k
const RANGE_LABEL: Record<Range, string> = { day: "today", week: "last 7 days", month: "last 30 days", all: "all time" }
const POLL_WHILE_SCANNING = 3000
const HEAT_DAYS = 26 * 7

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
  const url = (by: By, d: { from?: string; to?: string } = dates) => usageUrl({ by, ...d }, tz)
  const main = useUsage(url("model"), poll)
  const harness = useUsage(url("harness"), poll)
  const half = useUsage(url("harness", { from: shiftDay(today, -(HEAT_DAYS - 1)), to: today }), poll)
  const grouped = useUsage(table === "day" || table === "pr" ? null : url(table as By), poll)
  const prs = usePrUsage(table === "pr" ? dates : null, tz)
  const budgets = useBudgets(tz)

  const partial = [main, harness, half].some((r) => r.data && !r.data.complete)
  useEffect(() => setScanning(partial), [partial])
  const mainData = main.data

  const trend = useMemo(() => {
    const w = trendWindow(range, today, mainData?.series ?? [])
    const src = range === "all" ? mainData?.series : half.data?.series
    return src ? fillSeries(src, w.from, w.to) : []
  }, [range, today, mainData, half.data])

  const errors = [main.error, harness.error, half.error, grouped.error].filter((e): e is string => !!e)
  const retry = () => [main, harness, half, grouped].forEach((r) => r.reload())
  if (!mainData && main.loading) return <UsageSkeleton />
  if (!mainData)
    return (
      <div role="alert" className="flex items-center gap-3 p-6 font-mono text-xs text-failed">
        Usage not available ({errors[0] ?? "no data"}).
        <Button size="sm" variant="outline" onClick={retry}>
          Retry
        </Button>
      </div>
    )

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
  const tableRows = table === "day" ? dailyRows : table === "pr" ? (Array.isArray(prs.data?.rows) ? prs.data.rows : []).map(prRow) : (grouped.data?.groups ?? []).map((g) => groupRow(g, table))
  const tableMeta = TABLES.find((t) => t.id === table)!
  const toTable = () => {
    setTable("day")
    document.getElementById("usage-breakdown")?.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" })
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-lg font-bold tracking-tight">Usage</h1>
        <div role="tablist" aria-label="Range" className="flex rounded-lg border bg-card p-0.5">
          {RANGES.map((r) => (
            <button key={r.id} role="tab" aria-selected={range === r.id} onClick={() => setRange(r.id)}
              className={cn("h-7 rounded-md px-3 text-xs text-muted-foreground hover:text-foreground", range === r.id && "bg-accent font-medium text-foreground")}>
              {r.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3 font-mono text-xs text-muted-foreground">
          {scanning && <span>scanning logs · partial</span>}
          {main.stale && <span>loading…</span>}
          <span>{spanOf(u)}</span>
        </div>
      </header>
      {errors.length > 0 && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-failed/40 bg-failed/10 px-4 py-2 font-mono text-xs text-failed">
          <span className="min-w-0 flex-1">
            Usage request failed: {[...new Set(errors)].join(" · ")}
            {main.stale || harness.stale || half.stale ? " (showing the last answer)" : ""}
          </span>
          <Button size="sm" variant="outline" onClick={retry}>
            Retry
          </Button>
        </div>
      )}
      <div aria-label="Totals" {...busy(main.stale)}>
        <UsageTotals totals={u.totals} label={main.stale ? spanOf(u) : RANGE_LABEL[range]} />
      </div>
      {Array.isArray(budgets.data?.budgets) && budgets.data.budgets.length > 0 && (
        <Panel title="Budgets" aside={<span className="font-mono text-xs text-faint">est. · from config.json</span>}>
          <BudgetBars budgets={budgets.data.budgets} />
        </Panel>
      )}

      {/* items-start: each panel keeps its own height, so the shorter one leaves no blank band inside its card */}
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel
          title="Split"
          aside={
            <div role="tablist" aria-label="Split by" className="flex rounded-md border p-0.5 font-mono text-xs">
              {(["model", "harness"] as const).map((b) => (
                <button key={b} role="tab" aria-selected={splitBy === b} onClick={() => setSplitBy(b)}
                  className={cn("h-6 rounded px-2 text-muted-foreground hover:text-foreground", splitBy === b && "bg-accent text-foreground")}>
                  {b}
                </button>
              ))}
            </div>
          }
          bodyClassName="flex flex-col gap-4"
        >
          <div aria-label="Split" {...busyIn(split.stale, "flex flex-col gap-2")}>
            {split.stale && split.data && <span className="font-mono text-xs text-muted-foreground">{spanOf(split.data)} · loading…</span>}
            {split.data ? (
              <SplitBar groups={splitBy === "harness" ? splitGroups.map((g) => ({ ...g, name: harnessName(g.key) })) : splitGroups} label={splitBy} />
            ) : (
              <Skeleton className="h-6" />
            )}
          </div>
          <div aria-label="Harnesses" {...busyIn(harness.stale, "flex flex-col gap-2")}>
            {harness.stale && harness.data && <span className="font-mono text-xs text-muted-foreground">Harnesses · {spanOf(harness.data)} · loading…</span>}
            {!harness.data && <Skeleton className="h-20" />}
            {harness.data && harnessSlices.length === 0 && <p className="font-mono text-xs text-muted-foreground">No harness reported usage in this range.</p>}
            {harnessSlices.length > 0 && (
              <Strip className="grid-cols-[repeat(auto-fit,minmax(240px,1fr))]">
                {harnessSlices.map((s) => (
                  <StripCell
                    key={s.key}
                    k={s.key === "(other)" ? s.label : harnessName(s.key)}
                    // wraps between the parts when narrow; never clipped
                    sub={
                      <span data-harness-sub className="flex flex-wrap gap-x-1.5">
                        <span className="whitespace-nowrap">{compact(s.tokens)}</span>
                        <span className="whitespace-nowrap">· <span title={EST_TIP}>{estMoney(s.cost)}</span></span>
                        <span className="whitespace-nowrap">· {s.sessions} sessions</span>
                      </span>
                    }
                  >
                    <span className="flex items-center gap-2">
                      <i aria-hidden className="inline-block size-2 rounded-full" style={{ background: s.color }} />
                      {pct(s.tokens, harnessTotal)}
                    </span>
                  </StripCell>
                ))}
              </Strip>
            )}
          </div>
        </Panel>

        <Panel title="At a glance" label="Quick stats" bodyClassName="flex flex-col gap-3">
          <div {...busyIn(half.stale || main.stale, "flex flex-col gap-3")}>
            <Strip className="grid-cols-2">
              <StripCell k="Last 7 days">{compact(sum(last(7)))}</StripCell>
              <StripCell k="Last 30 days">{compact(sum(last(30)))}</StripCell>
              <StripCell k="Avg / active day">{compact(active.length ? sum(active) / active.length : 0)}</StripCell>
              <StripCell k="Active days" sub={`since ${firstDay ?? "–"}`}>{active.length}</StripCell>
            </Strip>
            <div className="font-mono text-xs text-muted-foreground">Top models</div>
            <ol className="flex flex-col gap-1.5 text-body">
              {topModels.length === 0 && <li className="font-mono text-xs text-muted-foreground">No models used in this range.</li>}
              {topModels.map((m, i) => (
                <li key={m.key} className="flex items-center gap-2">
                  <span className="w-4 font-mono text-xs text-faint">{i + 1}</span>
                  <i aria-hidden className="inline-block size-2 rounded-full" style={{ background: m.color }} />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{m.label}</span>
                  <span className="font-mono text-xs tabular-nums">{pct(m.tokens, modelTotal)}</span>
                </li>
              ))}
            </ol>
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Activity" aside={<span className="font-mono text-xs text-faint">26 weeks</span>}>
          <div {...busy(half.stale)}>{half.data ? <Heatmap series={halfSeries} today={today} tz={tz} onTable={toTable} /> : <Skeleton className="h-40" />}</div>
        </Panel>
        <Panel title="Trend" aside={<span className="font-mono text-xs text-faint">tokens per day</span>}>
          <div {...busy(range === "all" ? main.stale : half.stale)}>
            <TrendBars days={trend} />
          </div>
        </Panel>
      </div>

      <section id="usage-breakdown" className="min-w-0 scroll-mt-4 rounded-xl border bg-card" {...(main.stale || grouped.stale ? { "aria-busy": true } : {})}>
        <div className="flex min-h-10 flex-wrap items-center gap-3 border-b px-4 py-1.5">
          <h2 className="text-sm font-medium">Breakdown</h2>
          <div role="tablist" aria-label="Breakdown" className="flex flex-wrap rounded-md border p-0.5">
            {TABLES.map((t) => (
              <button key={t.id} role="tab" aria-selected={table === t.id} onClick={() => setTable(t.id)}
                className={cn("h-6 rounded px-2.5 text-xs text-muted-foreground hover:text-foreground", table === t.id && "bg-accent text-foreground")}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="p-2 sm:p-3">
          {table === "pr" ? (
            !prs.data ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <UsageTable key={`pr-${range}`} rows={Array.isArray(prs.data.rows) ? tableRows : []} nameLabel={tableMeta.name} defaultSort="cost"
                empty={prs.data.gh ? "No branch in this range maps to a pull request." : "Pull requests come from the GitHub CLI (gh); it is not installed or not logged in here."} />
            )
          ) : table !== "day" && !grouped.data ? (
            grouped.error ? (
              <div className="flex items-center gap-3 p-3 font-mono text-xs text-failed">
                {grouped.error}
                <Button size="sm" variant="outline" onClick={grouped.reload}>
                  Retry
                </Button>
              </div>
            ) : (
              <Skeleton className="h-40 w-full" />
            )
          ) : (
            <div className={cn("transition-opacity", (table === "day" ? main.stale : grouped.stale) && "opacity-50")}>
              <UsageTable key={`${table}-${range}`} rows={tableRows} nameLabel={tableMeta.name} defaultSort={table === "day" ? "name" : "cost"} />
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function UsageSkeleton() {
  return (
    <div className="flex w-full flex-col gap-4">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-20" />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Skeleton className="h-52" />
        <Skeleton className="h-52" />
      </div>
    </div>
  )
}
