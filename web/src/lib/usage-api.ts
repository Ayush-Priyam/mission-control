// /api/usage client for the Usage page: types, range and heatmap math, and a fetch hook.
// Local to Task 11 (parallel worktree); folded into api.ts when the views are wired up.
import { useCallback, useEffect, useReducer, useRef, useState } from "react"
import { fetchReducer, initialFetch, type Remote } from "@/lib/api"

export type By = "model" | "project" | "harness" | "day" | "worktree" | "branch"
export type Range = "day" | "week" | "month" | "all"
export const RANGES: { id: Range; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "all", label: "All" },
]

export type Tokens = { in: number; out: number; cacheRead: number; cacheWrite: number }
export type SeriesDay = Tokens & { day: string; cost: number; sessions: number; byKey: Record<string, number> }
export type Group = Tokens & { key: string; name?: string; cost: number; sessions: number }
export type Usage = {
  totals: Tokens & { cost: number; sessions: number }
  series: SeriesDay[]
  groups: Group[]
  by: By
  tz: string
  from: string | null
  to: string | null
  /** false while the server's first usage scan is still running (numbers are partial) */
  complete: boolean
}

export const totalTokens = (t: Tokens) => t.in + t.out + t.cacheRead + t.cacheWrite

/** The browser's IANA zone; the server buckets days in it. */
export const browserTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"

/** Calendar day (YYYY-MM-DD) of `now` in `tz`. */
export function todayIn(tz: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now)
}

/** Shift a YYYY-MM-DD by whole days (UTC arithmetic, so DST never skips a day). */
export function shiftDay(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}

/** Every day from `from` to `to`, inclusive. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = shiftDay(d, 1)) out.push(d)
  return out
}

/** Local days a range covers. Day: today; Week: last 7 days; Month: last 30 days; All: everything up to today. */
export function rangeDates(range: Range, today: string): { from?: string; to: string } {
  if (range === "day") return { from: today, to: today }
  if (range === "week") return { from: shiftDay(today, -6), to: today }
  if (range === "month") return { from: shiftDay(today, -29), to: today }
  return { to: today }
}

/** Days the trend bars show: the range, but Day widens to 14 days and All starts at the first day with data. */
export function trendWindow(range: Range, today: string, series: SeriesDay[]): { from: string; to: string } {
  if (range === "day") return { from: shiftDay(today, -13), to: today }
  if (range === "all") return { from: series[0]?.day ?? today, to: today }
  return { from: rangeDates(range, today).from!, to: today }
}

const emptyDay = (day: string): SeriesDay => ({ day, in: 0, out: 0, cacheRead: 0, cacheWrite: 0, cost: 0, sessions: 0, byKey: {} })

/** One entry per day from `from` to `to`; days the server did not report are zero. */
export function fillSeries(series: SeriesDay[], from: string, to: string): SeriesDay[] {
  const have = new Map(series.map((d) => [d.day, d]))
  return daysBetween(from, to).map((d) => have.get(d) ?? emptyDay(d))
}

export function usageUrl(q: { by: By; tz: string; from?: string; to?: string }): string {
  const p = new URLSearchParams({ by: q.by, tz: q.tz })
  if (q.from) p.set("from", q.from)
  if (q.to) p.set("to", q.to)
  return `/api/usage?${p}`
}

const quantile = (sorted: number[], p: number) => sorted[Math.floor((sorted.length - 1) * p)]

/** Heat level 0..4: 0 is no use; active days split by quartile of `active` (all non-zero values); the max is 4. */
export function levelOf(v: number, active: number[]): 0 | 1 | 2 | 3 | 4 {
  if (!(v > 0) || active.length === 0) return 0
  const s = [...active].sort((a, b) => a - b)
  if (v >= s[s.length - 1]) return 4
  if (v > quantile(s, 0.75)) return 4
  if (v > quantile(s, 0.5)) return 3
  if (v > quantile(s, 0.25)) return 2
  return 1
}

export type HeatCell = { day: string; value: number; cost: number; level: 0 | 1 | 2 | 3 | 4; future: boolean }
export type HeatGrid = { weeks: HeatCell[][]; months: { col: number; label: string }[]; total: number; activeDays: number }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** `weeks` Sunday-first columns ending with the week that holds `today`; each cell carries the day's total tokens. */
export function heatmapGrid(series: SeriesDay[], today: string, weeks = 26): HeatGrid {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay()
  const start = shiftDay(today, -dow - 7 * (weeks - 1))
  const have = new Map(series.map((d) => [d.day, d]))
  const days = daysBetween(start, shiftDay(start, weeks * 7 - 1))
  const values = days.map((d) => (d <= today ? totalTokens(have.get(d) ?? emptyDay(d)) : 0))
  const active = values.filter((v) => v > 0)
  const cells: HeatCell[] = days.map((d, i) => ({ day: d, value: values[i], cost: have.get(d)?.cost ?? 0, level: levelOf(values[i], active), future: d > today }))
  const cols = Array.from({ length: weeks }, (_, w) => cells.slice(w * 7, w * 7 + 7))
  const months: HeatGrid["months"] = []
  cols.forEach((col, i) => {
    const m = col[0].day.slice(5, 7)
    if (i === 0 || m !== cols[i - 1][0].day.slice(5, 7)) months.push({ col: i, label: MONTHS[+m - 1] })
  })
  return { weeks: cols, months, total: active.reduce((a, b) => a + b, 0), activeDays: active.length }
}

export type UsageRemote = Remote<Usage> & {
  /** true when `data` is the last answer for a different url, kept on screen while `url` loads or after it failed */
  stale: boolean
}

async function getUsage(url: string): Promise<Usage> {
  const r = await fetch(url)
  if (r.ok) return r.json()
  const j: { error?: string } = await r.json().catch(() => ({}))
  throw new Error(j.error ?? `usage: ${r.status}`)
}

/**
 * GET /api/usage for `url`; `null` loads nothing. Polls every `pollMs` while set (the page polls while the scan
 * is partial). While a new url loads (or fails), the last answer for an earlier url stays as `data` with `stale`.
 */
export function useUsage(url: string | null, pollMs = 0): UsageRemote {
  const [raw, dispatch] = useReducer(fetchReducer<Usage>, url, initialFetch<Usage>)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((n) => n + 1), [])
  const state = raw.url === url ? raw : initialFetch<Usage>(url)
  const last = useRef<Usage | null>(null)
  if (state.data) last.current = state.data
  useEffect(() => {
    dispatch({ type: "reset", url })
    if (url === null) return
    let cancelled = false
    const load = () =>
      getUsage(url).then(
        (data) => !cancelled && dispatch({ type: "ok", url, data }),
        (e: unknown) => !cancelled && dispatch({ type: "fail", url, error: e instanceof Error ? e.message : String(e) }),
      )
    load()
    const timer = pollMs ? setInterval(load, pollMs) : undefined
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [url, pollMs, tick])
  const stale = !state.data && url !== null && last.current !== null
  return { data: state.data ?? (stale ? last.current : null), stale, error: state.error, loading: state.loading, reload }
}

/** Today in `tz`, refreshed when the window regains focus and just after local midnight. */
export function useToday(tz: string): string {
  const [today, setToday] = useState(() => todayIn(tz))
  useEffect(() => {
    const check = () => setToday(todayIn(tz))
    check()
    const now = new Date()
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime() + 1000
    const t = setTimeout(check, midnight)
    window.addEventListener("focus", check)
    return () => {
      clearTimeout(t)
      window.removeEventListener("focus", check)
    }
  }, [tz, today])
  return today
}

/** 4354248744 -> "4,354,248,744" */
export const fmtInt = (n: number) => Math.round(n || 0).toLocaleString("en-US")
/** 4354248744 -> "4.35B"; small numbers stay whole. */
export function compact(n: number): string {
  const a = Math.abs(n || 0)
  if (a >= 1e9) return `${(n / 1e9).toFixed(a >= 1e11 ? 0 : a >= 1e10 ? 1 : 2)}B`
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M`
  if (a >= 1e3) return `${(n / 1e3).toFixed(a >= 1e5 ? 0 : 1)}k`
  return String(Math.round(n || 0))
}
/** Estimated dollars: "$3,544.66"; under a cent shows "$0.00". */
export const money = (n: number) => `$${(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
/** Every cost on the page is an estimate at API list prices (ruling V9). */
export const EST_TIP = "API list prices; subscription plans differ"
export const estMoney = (n: number) => `${money(n)} est.`
export const pct = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "0.0%")

/** Series colours for models / harnesses, in rank order; the last is "other". */
export const PALETTE = ["#a78bfa", "#2dd4bf", "#60a5fa", "#f472b6", "#fbbf24", "#a3e635"]
export const OTHER = "#52525b"
