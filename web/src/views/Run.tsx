import { useMemo } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CrewCards } from "@/components/CrewCards"
import { CrewMap } from "@/components/CrewMap"
import { StageBar } from "@/components/StageBar"
import { Thread } from "@/components/Thread"
import { YouBanner } from "@/components/YouBanner"
import { RunStatusBadge } from "@/views/Home"
import { useCapabilities, useRun } from "@/lib/api"
import { crewCards, crewGraph, currentStop, type CrewCard } from "@/lib/graph"
import { toHash, type Tab } from "@/lib/route"

type Ev = Record<string, any>

/** Tabs this view draws; the rest arrive with their own tasks and fall back to the map. */
const BUILT: Tab[] = ["chat", "map"]

function footer(events: Ev[], cards: CrewCard[]) {
  let cost = 0, tokens = 0
  for (const e of events) {
    if (e.type !== "session") continue
    cost += Number(e.cost) || 0
    const t = e.tokens ?? {}
    tokens += (t.input_tokens ?? 0) + (t.cache_creation_input_tokens ?? 0) + (t.output_tokens ?? 0)
  }
  const running = cards.filter((c) => c.status === "running").length
  const waiting = cards.filter((c) => c.status === "needs-you").length
  return [cost ? `$${cost.toFixed(2)}` : "", tokens ? `${Math.round(tokens / 1000)}k tok` : "", `${running} running`, waiting ? `${waiting} waiting on you` : ""]
    .filter(Boolean)
    .join(" · ")
}

export default function Run({ id, tab }: { id: string; tab: Tab }) {
  const run = useRun(id)
  const caps = useCapabilities()
  const data = run.data
  const view = useMemo(() => {
    if (!data) return null
    const state = data.state ?? {}
    const events = Array.isArray(data.events) ? data.events : []
    const graph = crewGraph(state, events)
    const stop = currentStop(state, events)
    const cards = crewCards(graph, state, events, data.live, stop)
    return { state, events, graph, stop, cards }
  }, [data])

  if (run.loading && !data) return <Skeleton className="h-64 w-full" />
  if (!view || !data)
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load run {id}</AlertTitle>
        <AlertDescription>{run.error ?? "no such run"}</AlertDescription>
      </Alert>
    )

  const { state, events, graph, stop, cards } = view
  const actions = caps.data?.actions ?? []
  const idea = String(state.idea ?? "")
  const current = BUILT.includes(tab) ? tab : "map"

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 flex-1 truncate text-lg font-extrabold tracking-tight">{idea || id}</h1>
          <RunStatusBadge run={{ id, idea, live: data.live, stages: state.stages ?? {} }} />
        </div>
        <StageBar stages={state.stages ?? {}} />
      </header>
      {stop && <YouBanner runId={id} stop={stop} actions={actions} onActed={run.reload} />}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Tabs value={current} onValueChange={(v) => (location.hash = toHash({ view: "run", id, tab: v as Tab }))}>
          <TabsList>
            <TabsTrigger value="chat">Chat</TabsTrigger>
            <TabsTrigger value="map">Map</TabsTrigger>
          </TabsList>
          <TabsContent value="chat" className="pt-3">
            <Thread runId={id} idea={idea} events={events} stop={stop} cards={cards} canSay={actions.includes("say")} />
          </TabsContent>
          <TabsContent value="map" className="pt-3">
            <CrewMap runId={id} graph={graph} cards={cards} events={events} />
          </TabsContent>
        </Tabs>
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <CrewCards runId={id} cards={cards} footer={footer(events, cards)} />
        </aside>
      </div>
    </div>
  )
}
