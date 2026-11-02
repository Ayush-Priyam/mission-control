import { Strip, StripCell } from "@/components/Panel"
import { compact, EST_TIP, fmtInt, money, totalTokens, type Usage } from "@/lib/usage"

/** The range's numbers as a summary strip (the item page's style): total, estimated cost, the four token kinds, sessions. */
export function UsageTotals({ totals, label }: { totals: Usage["totals"]; label: string }) {
  const total = totalTokens(totals)
  const parts: [string, number, string][] = [
    ["Input", totals.in, "Fresh, uncached tokens sent to the model"],
    ["Output", totals.out, "Tokens the model generated"],
    ["Cache write", totals.cacheWrite, "Tokens written into the prompt cache"],
    ["Cache read", totals.cacheRead, "Tokens served from the prompt cache (billed far lower)"],
  ]
  return (
    <section aria-label="Usage totals" className="flex flex-col gap-2">
      <h2 className="font-mono text-xs text-muted-foreground">Total tokens · {label}</h2>
      <Strip className="grid-cols-2 sm:grid-cols-4 xl:grid-cols-7">
        {/* 7 cells: at 4 columns the total takes two, so both rows are full */}
        <StripCell k="Total tokens" tip={`${fmtInt(total)} tokens`} cellClassName="sm:col-span-2 xl:col-span-1">
          <span data-testid="usage-total">{fmtInt(total)}</span>
        </StripCell>
        <StripCell k="Cost" tip={EST_TIP} sub="est. · API prices">
          {money(totals.cost)}
        </StripCell>
        {parts.map(([k, v, tip]) => (
          <StripCell key={k} k={k} tip={tip}>
            {compact(v)}
          </StripCell>
        ))}
        <StripCell k="Sessions">{fmtInt(totals.sessions)}</StripCell>
      </Strip>
    </section>
  )
}
