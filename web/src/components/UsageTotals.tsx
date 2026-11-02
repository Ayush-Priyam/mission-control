import { compact, fmtInt, money, totalTokens, type Usage } from "@/lib/usage-api"

/** The headline: total tokens for the range, estimated cost under it, and the four token kinds. */
export function UsageTotals({ totals, label }: { totals: Usage["totals"]; label: string }) {
  const total = totalTokens(totals)
  const parts: [string, number, string][] = [
    ["Input", totals.in, "Fresh, uncached tokens sent to the model"],
    ["Output", totals.out, "Tokens the model generated"],
    ["Cache write", totals.cacheWrite, "Tokens written into the prompt cache"],
    ["Cache read", totals.cacheRead, "Tokens served from the prompt cache (billed far lower)"],
  ]
  return (
    <section aria-label="Usage totals" className="flex flex-col items-center gap-1 py-2 text-center">
      <h2 className="font-mono text-[11px] tracking-widest text-muted-foreground">TOTAL TOKENS · {label.toUpperCase()}</h2>
      <p data-testid="usage-total" className="text-[clamp(2.25rem,6vw,4.25rem)] font-extrabold leading-none tracking-tight tabular-nums">
        {fmtInt(total)}
      </p>
      <p className="mt-2 font-mono text-xl font-bold text-[#22c55e]" title="Estimated from list prices; not a bill">
        {money(totals.cost)} <span className="text-xs font-normal text-muted-foreground">est.</span>
      </p>
      <dl className="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-1 font-mono text-xs text-muted-foreground">
        {parts.map(([k, v, tip]) => (
          <div key={k} className="flex gap-1.5" title={tip}>
            <dt>{k}</dt>
            <dd className="text-foreground">{compact(v)}</dd>
          </div>
        ))}
        <div className="flex gap-1.5">
          <dt>Sessions</dt>
          <dd className="text-foreground">{fmtInt(totals.sessions)}</dd>
        </div>
      </dl>
    </section>
  )
}
