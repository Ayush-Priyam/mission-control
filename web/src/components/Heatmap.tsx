import { useRef, useState } from "react"
import { ChartTip, tipAt } from "@/components/ChartTip"
import { compact, estMoney, heatmapGrid, type SeriesDay } from "@/lib/usage"
import { rovingKey } from "@/lib/roving"

export const HEAT = [0, 1, 2, 3, 4].map((i) => `var(--heat-${i})`)
const ROWS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

/**
 * 26 weeks of daily token use, Sunday-first columns. A CSS grid (labels keep their real 12px size). Each
 * day is a button in one roving tab stop: arrows move by day (up/down) and week (left/right), and the
 * value shows in a tooltip on focus or hover. The Daily breakdown table has the same numbers as text.
 */
export function Heatmap({ series, today, tz, onTable }: { series: SeriesDay[]; today: string; tz: string; onTable?: () => void }) {
  const g = heatmapGrid(series, today)
  const cells = g.weeks.flat()
  const lastPast = cells.reduce((m, c, i) => (c.future ? m : i), 0)
  const [active, setActive] = useState(lastPast)
  const [shown, setShown] = useState<number | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const show = (i: number | null) => {
    setShown(i)
    setAt(i === null ? null : tipAt(refs.current[i], box.current))
  }
  const cols = `26px repeat(${g.weeks.length}, minmax(0, 1fr))`
  const max = Math.max(0, ...cells.map((c) => c.value))
  const c = shown !== null ? cells[shown] : null
  return (
    <section aria-label="Activity heatmap" className="flex flex-col gap-3">
      <div ref={box} className="relative flex flex-col gap-1">
        <div className="grid h-4 gap-x-[3px]" style={{ gridTemplateColumns: cols }}>
          {g.months.map((m) => (
            <span key={m.col} data-heat-label className="font-mono text-xs leading-none whitespace-nowrap text-muted-foreground" style={{ gridColumn: m.col + 2, gridRow: 1 }}>{m.label}</span>
          ))}
        </div>
        <div
          role="grid"
          aria-label={`${g.activeDays} active days, ${compact(g.total)} tokens. Arrow keys move by day and week.`}
          className="grid gap-[3px]"
          style={{ gridTemplateColumns: cols, gridTemplateRows: "repeat(7, auto)", gridAutoFlow: "column" }}
          onKeyDown={(e) => {
            const next = rovingKey(e.key, active, lastPast + 1, 7)
            if (next === null) return
            e.preventDefault()
            setActive(next)
            refs.current[next]?.focus()
          }}
        >
          {ROWS.map((r, i) => (
            <span key={r} data-heat-label aria-hidden className="self-center font-mono text-xs leading-none text-muted-foreground" style={{ gridColumn: 1, gridRow: i + 1 }}>
              {i % 2 ? r : ""}
            </span>
          ))}
          {g.weeks.map((col, ci) =>
            col.map((cell, r) => {
              const i = ci * 7 + r
              const label = `${cell.day}: ${cell.value ? `${compact(cell.value)} tokens · ${estMoney(cell.cost)}` : "no use"}`
              return cell.future ? (
                <i key={cell.day} aria-hidden className="block aspect-square" style={{ gridColumn: ci + 2, gridRow: r + 1 }} />
              ) : (
                <button
                  key={cell.day}
                  ref={(el) => {
                    refs.current[i] = el
                  }}
                  type="button"
                  role="gridcell"
                  tabIndex={i === active ? 0 : -1}
                  aria-label={label}
                  data-level={cell.level}
                  onFocus={() => {
                    setActive(i)
                    show(i)
                  }}
                  onBlur={() => show(null)}
                  onMouseEnter={() => show(i)}
                  onMouseLeave={() => show(null)}
                  onClick={onTable}
                  className="block aspect-square rounded-[2px] focus-visible:outline-offset-1"
                  style={{ gridColumn: ci + 2, gridRow: r + 1, background: HEAT[cell.level] }}
                />
              )
            }),
          )}
        </div>
        <ChartTip at={at}>{c && `${c.day} · ${c.value ? `${compact(c.value)} tokens · ${estMoney(c.cost)}` : "no use"}`}</ChartTip>
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-2 font-mono text-xs text-muted-foreground">
        <span>
          {g.activeDays} active days · {tz}
          {onTable && (
            <>
              {" · "}
              <button type="button" onClick={onTable} className="underline underline-offset-2 hover:text-foreground">
                view as table
              </button>
            </>
          )}
        </span>
        <span className="flex items-center gap-1" aria-label={`Colour scale from no use to ${compact(max)} tokens a day`}>
          0
          {HEAT.map((h) => <i key={h} aria-hidden className="inline-block size-2.5 rounded-[2px]" style={{ background: h }} />)}
          {compact(max)}
        </span>
      </footer>
    </section>
  )
}
