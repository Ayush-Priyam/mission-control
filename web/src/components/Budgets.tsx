import { Wallet } from "lucide-react"
import { budgetAlert, type BudgetState } from "@/lib/api-v22"
import { money } from "@/lib/format"
import { toHash } from "@/lib/route"
import { cn } from "@/lib/utils"

const PERIOD: Record<BudgetState["period"], string> = { daily: "today", weekly: "last 7 days", monthly: "last 30 days" }
const tone = (l: BudgetState["level"]) => (l === "over" ? "bg-failed" : l === "warn" ? "bg-consult" : "bg-running")
const pctText = (r: number) => `${Math.round(r * 100)}%`

/** One bar per budget and period: spent of limit, coloured at 80% and 100%. */
export function BudgetBars({ budgets }: { budgets: BudgetState[] }) {
  return (
    <ul className="flex flex-col gap-2.5" aria-label="Budgets">
      {budgets.map((b) => (
        <li key={`${b.scope}|${b.match}|${b.period}`} data-budget={b.level} className="text-xs">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate">
              <span className="text-muted-foreground">{b.scope}</span> <span className="font-mono">{b.match}</span> <span className="text-faint">· {PERIOD[b.period]}</span>
            </span>
            <span className={cn("shrink-0 font-mono tabular-nums", b.level === "over" ? "text-failed" : b.level === "warn" ? "text-consult" : "text-muted-foreground")}>
              {money(b.spent)} / {money(b.limit)} · {pctText(b.ratio)}
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(1, b.ratio) * 100)} aria-label={`${b.scope} ${b.match} ${PERIOD[b.period]}`}>
            <i className={cn("block h-full rounded-full", tone(b.level))} style={{ width: `${Math.min(1, b.ratio) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Top-bar chip when a budget is at 80% or over; links to the Usage page. */
export function BudgetChip({ budgets }: { budgets: BudgetState[] | undefined }) {
  const b = budgetAlert(budgets)
  if (!b) return null
  const over = b.level === "over"
  return (
    <a
      href={toHash({ view: "usage" })}
      data-budget-chip={b.level}
      title={`${b.scope} ${b.match}: ${money(b.spent)} of ${money(b.limit)} ${PERIOD[b.period]} (estimate)`}
      className={cn("flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 font-mono text-xs whitespace-nowrap", over ? "border-failed/50 text-failed" : "border-consult/50 text-consult")}
    >
      <Wallet className="size-3.5" />
      {over ? "Over budget" : `Budget ${pctText(b.ratio)}`}
    </a>
  )
}
