import { useState } from "react"
import { useExtra } from "@/lib/api"
import { DriftPanel } from "@/components/DriftPanel"
import { Markdown } from "@/components/Markdown"
import { TokenPanel } from "@/components/TokenPanel"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

type Detail = Record<string, { state?: string; done?: number; total?: number; verdict?: string | null }>

const STATE: Record<string, string> = {
  done: "border-running/60 bg-running/15",
  current: "border-consult/70 bg-consult/15",
  blocked: "border-failed/70 bg-failed/15",
  pending: "border-border bg-muted/40 text-muted-foreground",
}

function DocBody({ runId, path }: { runId: string; path: string }) {
  const r = useExtra<{ content: string }>("doc", runId, { path })
  if (r.loading && !r.data) return <Skeleton className="m-4 h-40" />
  if (!r.data) return <p className="p-4 font-mono text-xs text-failed">Could not read {path} ({r.error ?? "not found"}).</p>
  return <Markdown text={r.data.content} className="p-4" />
}

/** The Docs tab (spec-kit): the pipeline, a stage's document, the compound store, then drift and token spend. */
export default function Docs({ runId, state }: { runId: string; state: Record<string, any> }) {
  const detail: Detail = state.detail && typeof state.detail === "object" ? state.detail : {}
  const files: Record<string, string> = state.files && typeof state.files === "object" ? state.files : {}
  const store: string[] = Array.isArray(state.compound) ? state.compound : []
  const stages = Object.keys(detail).length ? Object.keys(detail) : Object.keys(files)
  const first = stages.find((s) => files[s])
  const [stage, setStage] = useState<string | null>(null)
  const [path, setPath] = useState<string | null>(null)
  const curStage = stage ?? first ?? null
  const curPath = path ?? (curStage ? files[curStage] : null) ?? null
  const done = stages.filter((s) => detail[s]?.state === "done").length
  const groups = ["adr", "corrections", "patterns"].map((g) => ({ g, items: store.filter((p) => p.includes(`/compound/${g}/`)) }))

  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Pipeline" className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between font-mono text-xs tracking-widest text-muted-foreground">
          <span>PIPELINE</span><span>{done}/{stages.length} STAGES COMPLETE · CLICK A STAGE TO OPEN ITS DOCUMENT</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {stages.map((s) => {
            const st = detail[s]
            return (
              <button key={s} type="button" disabled={!files[s]} aria-pressed={curStage === s}
                onClick={() => { setStage(s); setPath(null) }}
                className={cn("rounded-md border px-2.5 py-1.5 font-mono text-xs transition-colors disabled:opacity-50", STATE[st?.state ?? "pending"] ?? STATE.pending, curStage === s && !path && "ring-2 ring-ring")}>
                {s}{st?.total ? ` ${st.done}/${st.total}` : ""}
              </button>
            )
          })}
        </div>
      </section>
      <section aria-label="Document" className="rounded-xl border bg-card">
        <p className="border-b px-4 py-2 font-mono text-xs text-muted-foreground">{curPath ?? "no documents yet"}</p>
        {curPath ? <ScrollArea className="h-[50vh]"><DocBody key={curPath} runId={runId} path={curPath} /></ScrollArea> : <p className="p-6 text-center font-mono text-xs text-muted-foreground">Nothing to read yet.</p>}
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="Compound store" className="flex flex-col gap-2 rounded-xl border bg-card p-4">
          <h3 className="font-mono text-xs tracking-widest text-muted-foreground">COMPOUND STORE</h3>
          {store.length === 0 ? (
            <p className="font-mono text-xs text-muted-foreground">EMPTY · GROWS FROM YOUR FIRST WRITEBACK</p>
          ) : (
            groups.map(({ g, items }) => (
              <div key={g} className="flex flex-wrap items-center gap-1.5">
                <span className="w-32 flex-none font-mono text-xs whitespace-nowrap text-muted-foreground">{g} · {items.length}</span>
                {items.map((p) => (
                  <button key={p} type="button" onClick={() => { setPath(p) }} title={p}
                    className={cn("rounded border px-1.5 py-0.5 font-mono text-xs hover:bg-muted", curPath === p && "bg-muted ring-1 ring-ring")}>
                    {p.split("/").pop()!.replace(/\.md$/, "")}
                  </button>
                ))}
              </div>
            ))
          )}
        </section>
        <TokenPanel runId={runId} />
      </div>
      <DriftPanel runId={runId} />
    </div>
  )
}
