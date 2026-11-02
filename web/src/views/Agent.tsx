import { useMemo, useState } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { SayBox } from "@/components/SayBox"
import { StageLog } from "@/components/StageLog"
import { Workbench } from "@/components/Workbench"
import { SessionSheet } from "@/components/SessionSheet"
import { useCapabilities, useRun } from "@/lib/api"
import { short, stageEvents } from "@/lib/events"
import { crewCards, crewGraph, currentStop, nodeOf } from "@/lib/graph"
import { toHash } from "@/lib/route"

const WORD: Record<string, string> = { running: "working", "needs-you": "needs you", failed: "failed", done: "done", skipped: "skipped", idle: "idle" }

/** One stage's console: its events and sessions in order, what you have sent it, and the answer box when allowed. */
export default function Agent({ id, stage }: { id: string; stage: string }) {
  const run = useRun(id)
  const caps = useCapabilities()
  const [session, setSession] = useState<string | null>(null)
  const [queue, setQueue] = useState<{ to: string; text: string }[]>([])
  const data = run.data
  const view = useMemo(() => {
    if (!data) return null
    const state = data.state ?? {}
    const events = Array.isArray(data.events) ? data.events : []
    const graph = crewGraph(state, events)
    const node = nodeOf(graph, stage)
    const card = node ? crewCards({ ...graph, nodes: [node] }, state, events, data.live, currentStop(state, events))[0] : null
    return { log: stageEvents(events, [stage]), card, events, agent: node?.id ?? stage, stages: node?.stages ?? [stage] }
  }, [data, stage])

  if (run.loading && !data) return <Skeleton className="h-64 w-full" />
  if (!view)
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load run {id}</AlertTitle>
        <AlertDescription>{run.error ?? "no such run"}</AlertDescription>
      </Alert>
    )

  const canSay = (caps.data?.actions ?? []).includes("say")
  const status = view.card?.status ?? "idle"

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <header className="flex flex-wrap items-baseline gap-3">
        <h1 className="font-mono text-lg font-bold">{stage}</h1>
        <span className={`font-mono text-xs ${status === "running" ? "text-running" : status === "needs-you" ? "text-needs-you" : status === "failed" ? "text-failed" : "text-muted-foreground"}`}>
          {WORD[status]}
          {view.card && view.card.rounds > 1 ? ` · round ${view.card.rounds}` : ""}
        </span>
        {view.card?.chip && <span className="font-mono text-xs text-muted-foreground">{view.card.chip.text}</span>}
        <a href={toHash({ view: "run", id, tab: "map" })} className="ml-auto font-mono text-xs text-muted-foreground hover:text-foreground">
          ← back to the run
        </a>
      </header>
      <section aria-label="Log" className="rounded-xl border bg-card p-3">
        <StageLog events={view.log} empty={`No events for ${stage} yet.`} onSession={setSession} />
      </section>
      {(caps.data?.extras ?? []).includes("artifacts") && <Workbench runId={id} agent={view.agent} stages={view.stages} events={view.events} />}
      {queue.length > 0 && (
        <section aria-label="Sent" className="flex flex-col gap-1 rounded-xl border p-3 font-mono text-xs">
          <h2 className="text-xs tracking-widest text-muted-foreground">SENT</h2>
          {queue.slice(-5).map((q, i) => (
            <div key={i} className="flex gap-3">
              <span className="text-consult">→ {q.to}</span>
              <span className="min-w-0 flex-1 truncate">{short(q.text, 80)}</span>
              <span className="text-muted-foreground">sent</span>
            </div>
          ))}
        </section>
      )}
      {canSay && (
        <SayBox
          runId={id}
          stage={stage}
          placeholder={`Message ${stage}, or @stage …`}
          onSent={(m) => {
            setQueue((q) => [...q, { to: m.stage, text: m.text }])
            run.reload()
          }}
        />
      )}
      <SessionSheet runId={id} name={session} onClose={() => setSession(null)} />
    </div>
  )
}
