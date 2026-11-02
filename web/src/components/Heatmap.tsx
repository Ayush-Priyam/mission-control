import { compact, estMoney, heatmapGrid, type SeriesDay } from "@/lib/usage-api"

export const HEAT = ["#1c1c1f", "#14532d", "#15803d", "#16a34a", "#22c55e"]
const ROWS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const CELL = 11, GAP = 3, STEP = CELL + GAP, LEFT = 30, TOP = 16

/** 26 weeks of daily token use, Sunday-first columns, GitHub style. */
export function Heatmap({ series, today, tz }: { series: SeriesDay[]; today: string; tz: string }) {
  const g = heatmapGrid(series, today)
  const w = LEFT + g.weeks.length * STEP + 14, h = TOP + 7 * STEP
  return (
    <section aria-label="Activity heatmap" className="flex flex-col gap-3">
      <header className="flex items-baseline justify-between">
        <h3 className="font-mono text-[11px] tracking-widest text-muted-foreground">ACTIVITY · 26 WEEKS</h3>
        <span className="font-mono text-[11px] text-muted-foreground">{tz}</span>
      </header>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label={`${g.activeDays} active days, ${compact(g.total)} tokens`}>
        {g.months.map((m) => (
          <text key={m.col} x={LEFT + m.col * STEP} y={10} className="fill-muted-foreground font-mono" fontSize={11}>{m.label}</text>
        ))}
        {ROWS.map((r, i) => (i % 2 ? <text key={r} x={0} y={TOP + i * STEP + CELL - 2} className="fill-muted-foreground font-mono" fontSize={11}>{r}</text> : null))}
        {g.weeks.map((col, c) =>
          col.map((cell, r) =>
            cell.future ? null : (
              <rect key={cell.day} data-level={cell.level} x={LEFT + c * STEP} y={TOP + r * STEP} width={CELL} height={CELL} rx={2} fill={HEAT[cell.level]}>
                <title>{`${cell.day}: ${cell.value ? `${compact(cell.value)} tokens · ${estMoney(cell.cost)}` : "no use"}`}</title>
              </rect>
            ),
          ),
        )}
      </svg>
      <footer className="flex items-center justify-between font-mono text-[11px] text-muted-foreground">
        <span>{g.activeDays} active days</span>
        <span className="flex items-center gap-1">
          Less
          {HEAT.map((c) => <i key={c} className="inline-block size-2.5 rounded-[2px]" style={{ background: c }} />)}
          More
        </span>
      </footer>
    </section>
  )
}
