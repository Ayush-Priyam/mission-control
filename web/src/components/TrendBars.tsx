import { useRef, useState } from "react"
import { ChartTip, tipAt } from "@/components/ChartTip"
import { compact, estMoney, totalTokens, type SeriesDay } from "@/lib/usage"
import { rovingKey } from "@/lib/roving"

/**
 * One bar per day (already zero-filled), height by total tokens; today is the last bar. A y-scale
 * (0 · ½ peak · peak) on the left; each bar is a button in one roving tab stop (←/→/Home/End) whose
 * value shows in a tooltip on focus or hover.
 */
export function TrendBars({ days }: { days: SeriesDay[] }) {
  const vals = days.map(totalTokens)
  const max = Math.max(0, ...vals)
  const [active, setActive] = useState(Math.max(0, days.length - 1))
  const [shown, setShown] = useState<number | null>(null)
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const show = (i: number | null) => {
    setShown(i)
    setAt(i === null ? null : tipAt(refs.current[i], box.current))
  }
  const d = shown !== null ? days[shown] : null
  return (
    <section aria-label="Usage trend" className="flex flex-col gap-2">
      <div className="flex gap-2">
        <div aria-hidden className="flex h-36 flex-col justify-between py-0 text-right font-mono text-xs leading-none text-muted-foreground">
          <span>{compact(max)}</span>
          <span>{compact(max / 2)}</span>
          <span>0</span>
        </div>
        <div ref={box} className="relative min-w-0 flex-1">
          <div
            role="group"
            aria-label={`Tokens per day, peak ${compact(max)}. Arrow keys move between days.`}
            className="relative flex h-36 items-end gap-[2px] border-b border-border"
            onKeyDown={(e) => {
              const next = rovingKey(e.key, active, days.length)
              if (next === null) return
              e.preventDefault()
              setActive(next)
              refs.current[next]?.focus()
            }}
          >
            {[0.5, 1].map((f) => <i key={f} aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border" style={{ bottom: `${f * 100}%` }} />)}
            {days.map((day, i) => (
              <button
                key={day.day}
                ref={(el) => {
                  refs.current[i] = el
                }}
                type="button"
                tabIndex={i === active ? 0 : -1}
                aria-label={`${day.day}: ${compact(vals[i])} tokens · ${estMoney(day.cost)} · ${day.sessions} sessions`}
                onFocus={() => {
                  setActive(i)
                  show(i)
                }}
                onBlur={() => show(null)}
                onMouseEnter={() => show(i)}
                onMouseLeave={() => show(null)}
                className="group relative flex h-full min-w-0 flex-1 items-end focus-visible:outline-offset-1"
              >
                <i data-day={day.day} className="block w-full rounded-t-[2px] bg-heat-3 group-hover:bg-heat-4 group-focus-visible:bg-heat-4" style={{ height: max ? `${(vals[i] / max) * 100}%` : 0, minHeight: vals[i] ? 2 : 0 }} />
              </button>
            ))}
          </div>
          <ChartTip at={at}>{d && `${d.day} · ${compact(totalTokens(d))} tokens · ${estMoney(d.cost)} · ${d.sessions} sessions`}</ChartTip>
          <footer className="mt-1.5 flex justify-between font-mono text-xs text-muted-foreground">
            <span>{days[0]?.day}</span>
            <span>{days.at(-1)?.day}</span>
          </footer>
        </div>
      </div>
    </section>
  )
}
