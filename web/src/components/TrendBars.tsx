import { compact, estMoney, totalTokens, type SeriesDay } from "@/lib/usage"

/** One bar per day (already zero-filled), height by total tokens; today is the last bar. */
export function TrendBars({ days }: { days: SeriesDay[] }) {
  const vals = days.map(totalTokens)
  const max = Math.max(0, ...vals)
  return (
    <section aria-label="Usage trend" className="flex flex-col gap-3">
      <header className="flex items-baseline justify-between">
        <h3 className="font-mono text-[11px] tracking-widest text-muted-foreground">USAGE TREND</h3>
        <span className="font-mono text-[11px] text-muted-foreground">peak {compact(max)}</span>
      </header>
      <div className="relative flex h-36 items-end gap-[2px] border-b border-border">
        {[0.25, 0.5, 0.75, 1].map((f) => <i key={f} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border/60" style={{ bottom: `${f * 100}%` }} />)}
        {days.map((d, i) => (
          <div key={d.day} className="group relative flex h-full flex-1 items-end" title={`${d.day}: ${compact(vals[i])} tokens · ${estMoney(d.cost)} · ${d.sessions} sessions`}>
            <i data-day={d.day} className="block w-full rounded-t-[2px] bg-[#22c55e] opacity-85 group-hover:opacity-100" style={{ height: max ? `${(vals[i] / max) * 100}%` : 0, minHeight: vals[i] ? 2 : 0 }} />
          </div>
        ))}
      </div>
      <footer className="flex justify-between font-mono text-[11px] text-muted-foreground">
        <span>{days[0]?.day}</span>
        <span>{days.at(-1)?.day}</span>
      </footer>
    </section>
  )
}
