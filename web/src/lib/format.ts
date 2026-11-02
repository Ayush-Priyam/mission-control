import { useEffect, useState } from "react"

/** Short age of a timestamp: "now", "42s", "5m", "3h", "2d" (null/invalid: "–"). */
export function ago(ts: string | null | undefined, now = Date.now()): string {
  const t = ts ? Date.parse(ts) : NaN
  if (!Number.isFinite(t)) return "–"
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 5) return "now"
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

/** Dollars: "$0.84", "$12.30", "–" for zero, "<$0.01" for crumbs. */
export function money(n: number | null | undefined): string {
  if (!n || !Number.isFinite(n)) return "–"
  if (n < 0.01) return "<$0.01"
  return `$${n < 100 ? n.toFixed(2) : Math.round(n).toLocaleString("en-US")}`
}

/** Compact count: 960, 1.4k, 7.9M. */
export function compact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "–"
  if (n < 1000) return String(n)
  if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}k`
  return `${(n / 1e6).toFixed(1)}M`
}

/** The current time, refreshed every `ms` so ages keep moving when polls bring nothing new. */
export function useNow(ms = 10_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}
