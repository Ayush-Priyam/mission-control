import { useState } from "react"
import { EST_TIP, fmtInt, money, totalTokens, type Tokens } from "@/lib/usage"
import { cn } from "@/lib/utils"

export type UsageRowView = Tokens & { key: string; label: string; sub?: string; cost: number; sessions: number }
type Col = { id: string; label: string; tip?: string; v: (r: UsageRowView) => number; fmt: (n: number) => string }

const COLS: Col[] = [
  { id: "total", label: "Total", v: totalTokens, fmt: fmtInt },
  { id: "in", label: "Input", v: (r) => r.in, fmt: fmtInt },
  { id: "out", label: "Output", v: (r) => r.out, fmt: fmtInt },
  { id: "cacheWrite", label: "Cache write", v: (r) => r.cacheWrite, fmt: fmtInt },
  { id: "cacheRead", label: "Cache read", v: (r) => r.cacheRead, fmt: fmtInt },
  { id: "cost", label: "Est. cost", tip: EST_TIP, v: (r) => r.cost, fmt: money },
  { id: "sessions", label: "Sessions", v: (r) => r.sessions, fmt: fmtInt },
]

/**
 * Token columns for a list of rows (days, projects, worktrees...). Click a header to sort by it;
 * `defaultSort` "name" keeps the given order (newest day first for the daily breakdown).
 */
export function UsageTable({ rows, nameLabel, defaultSort = "name", empty = "No usage in this range.", limit = 90 }: { rows: UsageRowView[]; nameLabel: string; defaultSort?: string; empty?: string; limit?: number }) {
  const [sort, setSort] = useState(defaultSort)
  const [all, setAll] = useState(false)
  const col = COLS.find((c) => c.id === sort)
  const sorted = col ? [...rows].sort((a, b) => col.v(b) - col.v(a)) : rows
  const shown = all ? sorted : sorted.slice(0, limit)
  if (!rows.length) return <p className="py-8 text-center font-mono text-xs text-muted-foreground">{empty}</p>
  const th = (id: string, label: string, right = true, tip?: string) => (
    <th key={id} title={tip} className={cn("px-3 py-2 font-normal", right ? "text-right" : "text-left")}>
      <button type="button" onClick={() => setSort(id)} aria-sort={sort === id ? "descending" : undefined} className={cn("cursor-pointer hover:text-foreground", sort === id && "text-foreground")}>
        {label}
        {sort === id ? " ▾" : ""}
      </button>
    </th>
  )
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-[13px]">
        <thead className="border-b text-xs text-muted-foreground">
          <tr>
            {th("name", nameLabel, false)}
            {COLS.map((c) => th(c.id, c.label, true, c.tip))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.key} className="border-b last:border-0 hover:bg-muted/40">
              <td className="max-w-56 px-3 py-2.5">
                <div className="truncate" title={r.sub ?? r.label}>{r.label}</div>
                {r.sub && <div className="truncate font-mono text-[11px] text-muted-foreground">{r.sub}</div>}
              </td>
              {COLS.map((c) => (
                <td key={c.id} className={cn("px-3 py-2.5 text-right font-mono tabular-nums", c.id === "total" ? "text-foreground" : "text-muted-foreground", c.id === "cost" && "text-foreground")}>
                  {c.fmt(c.v(r))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {shown.length < sorted.length && (
        <button type="button" onClick={() => setAll(true)} className="mt-2 w-full rounded-md py-2 font-mono text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground">
          Show all {sorted.length} rows
        </button>
      )}
    </div>
  )
}
