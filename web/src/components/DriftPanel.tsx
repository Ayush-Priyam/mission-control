import { useExtra } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { parseInline } from "@/lib/markdown"
import { cn } from "@/lib/utils"

type Report = { verdict: string | null; drift: { level: string; kind?: string; text: string; severity: string }[] }
type Drift = { intentguard?: Report; planverify?: Report }

const SEVERITY: Record<string, string> = { blocked: "text-failed", review: "text-foreground" }
const verdictTone = (v: string | null) => (!v ? "bg-muted text-muted-foreground" : /BLOCK/.test(v) ? "bg-failed/15 text-failed" : /REVIEW/.test(v) ? "bg-needs-you/15 text-needs-you" : "bg-running/15 text-running")

function Inline({ text }: { text: string }) {
  return <>{parseInline(text).map((r, i) => (r.k === "code" ? <code key={i} className="rounded bg-muted px-1 font-mono text-[0.9em]">{r.text}</code> : r.k === "b" ? <b key={i}>{r.text}</b> : r.text))}</>
}

function Section({ title, empty, r }: { title: string; empty: string; r?: Report }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 font-mono text-[11px] tracking-widest text-muted-foreground">
        {title}
        <Badge className={verdictTone(r?.verdict ?? null)}>{r?.verdict ?? empty}</Badge>
      </div>
      {!!r?.drift?.length && (
        <ul className="flex flex-col gap-1.5 text-[13px]">
          {r.drift.map((d, i) => (
            <li key={i} className={cn("flex gap-2", SEVERITY[d.severity])}>
              <b className="flex-none font-mono text-[11px] tracking-wider">{d.level}</b>
              <span className="text-foreground"><Inline text={d.text} /></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Validation drift for the feature: the plan-verify and intent-guard verdicts with their findings. */
export function DriftPanel({ runId }: { runId: string }) {
  const r = useExtra<Drift>("drift", runId)
  if (r.loading && !r.data) return <Skeleton className="h-24 w-full" />
  if (!r.data) return <p className="font-mono text-xs text-failed">Drift not available ({r.error ?? "none"}).</p>
  return (
    <section aria-label="Drift" className="flex flex-col gap-4 rounded-xl border bg-card p-4">
      <Section title="PLAN VERIFY" empty="NOT VERIFIED" r={r.data.planverify} />
      <Section title="INTENT GUARD" empty="NOT VALIDATED" r={r.data.intentguard} />
    </section>
  )
}
