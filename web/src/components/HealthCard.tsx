import type { Health } from "@/lib/item"
import { estCost, EST_TIP } from "@/lib/item"
import { cn } from "@/lib/utils"

/** A ring for the share of calls that did not fail. */
function Ring({ value }: { value: number | null }) {
  const r = 26
  const c = 2 * Math.PI * r
  const v = value ?? 0
  // Neutral while most calls succeed; red only below 70%. Amber is reserved for "needs you".
  const tone = value === null ? "stroke-border" : v >= 0.7 ? "stroke-foreground/70" : "stroke-failed"
  return (
    <svg viewBox="0 0 64 64" className="size-16 shrink-0" role="img" aria-label={value === null ? "no calls" : `${Math.round(v * 100)}% of calls ok`}>
      <circle cx="32" cy="32" r={r} fill="none" strokeWidth="5" className="stroke-border" />
      {value !== null && (
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${v * c} ${c}`} transform="rotate(-90 32 32)" className={tone} />
      )}
      <text x="32" y="33" textAnchor="middle" className="fill-foreground text-[15px] font-bold">
        {value === null ? "–" : `${Math.round(v * 100)}%`}
      </text>
      {value !== null && (
        <text x="32" y="45" textAnchor="middle" className="fill-muted-foreground text-[9px]">
          calls ok
        </text>
      )}
    </svg>
  )
}

function Row({ k, v, tone, tip }: { k: string; v: string; tone?: string; tip?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[13px]" title={tip}>
      <span className="text-muted-foreground">{k}</span>
      <span className={cn("font-mono text-xs tabular-nums", tone)}>{v}</span>
    </div>
  )
}

/** Run health so far: calls ok (ring), error rate, rework and send-backs, cache use, budget when the source knows it. */
export function HealthCard({ h, live = true }: { h: Health; live?: boolean }) {
  const errRate = h.calls ? h.errors / h.calls : 0
  return (
    <section aria-label="Health" className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">Health</h3>
        <span className="font-mono text-xs text-faint">{live ? "so far" : "final"}</span>
      </div>
      <div className="flex items-center gap-4">
        <Ring value={h.okRate} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Row k="Issues" v={h.calls ? `${h.errors} · ${(errRate * 100).toFixed(errRate && errRate < 0.1 ? 1 : 0)}%` : String(h.errors)} tone={h.errors ? "text-failed" : undefined} tip="A session: failed calls over all calls. A run: issues raised over all calls" />
          <Row k="Sent back" v={h.sendBacks ? `↩ ${h.sendBacks}` : "0"} tone={h.sendBacks ? "text-foreground" : undefined} tip="Work a later stage sent back to an earlier one" />
          {h.failedRounds > 0 && <Row k="Failed rounds" v={String(h.failedRounds)} tone="text-failed" tip="Rounds that ended failed; a later round may have passed" />}
          {h.rework > 0 && <Row k="Extra rounds" v={`↻ ${h.rework}`} tone="text-foreground" tip="Rounds beyond the first, over all stages" />}
          {h.consults > 0 && <Row k="Questions" v={String(h.consults)} tone="text-consult" />}
          <Row k="Cache use" v={h.cache === null ? "–" : `${Math.round(h.cache * 100)}%`} tip="Cache reads over all input" />
          {h.budget && <Row k="Budget" v={`${estCost(h.budget.spent).replace(/ est\.$/, "")} / $${h.budget.limit}`} tip={EST_TIP} tone={h.budget.spent > h.budget.limit ? "text-failed" : undefined} />}
        </div>
      </div>
    </section>
  )
}
