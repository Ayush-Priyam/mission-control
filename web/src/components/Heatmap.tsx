import { compact, estMoney, heatmapGrid, type SeriesDay } from "@/lib/usage-api"

export const HEAT = ["#1c1c1f", "#14532d", "#15803d", "#16a34a", "#22c55e"]
const ROWS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

/**
 * 26 weeks of daily token use, Sunday-first columns, GitHub style. A CSS grid rather than a scaled SVG,
 * so the month and weekday labels keep their real 10px size at any card width.
 */
export function Heatmap({ series, today, tz }: { series: SeriesDay[]; today: string; tz: string }) {
  const g = heatmapGrid(series, today)
  const cols = `26px repeat(${g.weeks.length}, minmax(0, 1fr))`
  return (
    <section aria-label="Activity heatmap" className="flex flex-col gap-3">
      <header className="flex items-baseline justify-between">
        <h3 className="font-mono text-[11px] tracking-widest text-muted-foreground">ACTIVITY · 26 WEEKS</h3>
        <span className="font-mono text-[11px] text-muted-foreground">{tz}</span>
      </header>
      <div role="img" aria-label={`${g.activeDays} active days, ${compact(g.total)} tokens`} className="flex flex-col gap-1">
        <div className="grid h-3.5 gap-x-[3px]" style={{ gridTemplateColumns: cols }}>
          {g.months.map((m) => (
            <span key={m.col} data-heat-label className="whitespace-nowrap font-mono text-[10px] leading-none text-muted-foreground" style={{ gridColumn: m.col + 2, gridRow: 1 }}>{m.label}</span>
          ))}
        </div>
        <div className="grid gap-[3px]" style={{ gridTemplateColumns: cols, gridTemplateRows: "repeat(7, auto)", gridAutoFlow: "column" }}>
          {ROWS.map((r, i) => (
            <span key={r} data-heat-label className="self-center font-mono text-[10px] leading-none text-muted-foreground" style={{ gridColumn: 1, gridRow: i + 1 }}>
              {i % 2 ? r : ""}
            </span>
          ))}
          {g.weeks.map((col, c) =>
            col.map((cell, r) => (
              <i
                key={cell.day}
                data-level={cell.future ? undefined : cell.level}
                title={cell.future ? undefined : `${cell.day}: ${cell.value ? `${compact(cell.value)} tokens · ${estMoney(cell.cost)}` : "no use"}`}
                className="block aspect-square rounded-[2px]"
                style={{ gridColumn: c + 2, gridRow: r + 1, background: cell.future ? "transparent" : HEAT[cell.level] }}
              />
            )),
          )}
        </div>
      </div>
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
