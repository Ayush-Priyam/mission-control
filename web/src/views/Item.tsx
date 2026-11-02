import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ItemMap } from "@/components/ItemMap"
import { LaneCards } from "@/components/LaneCards"
import { LaneSheet } from "@/components/LaneSheet"
import { RightRail } from "@/components/RightRail"
import { StatusDot, STATUS_LABEL, STATUS_TEXT } from "@/components/StatusDot"
import { SummaryStrip } from "@/components/SummaryStrip"
import { Thread } from "@/components/Thread"
import { TokenPanel } from "@/components/TokenPanel"
import Board from "@/views/Board"
import Calls from "@/views/Calls"
import DiffView from "@/views/Diff"
import Docs from "@/views/Docs"
import Qa from "@/views/Qa"
import Trace from "@/views/Trace"
import { useCalls, useCapabilities, useExtra, useItem, useSources, type ItemDetail } from "@/lib/api"
import { extraTabs, normaliseDiff, normaliseTasks, qaRows, runChanges } from "@/lib/extras"
import { useNow } from "@/lib/format"
import { crewCards, crewGraph, currentStop } from "@/lib/graph"
import { laneExtras } from "@/lib/item"
import { toHash } from "@/lib/route"
import { cn } from "@/lib/utils"

const LIVE_POLL = 2000
const IDLE_POLL = 10000

/** The tabs an item shows: the v2 four plus a v1 run's extras when its adapter lists them. */
export function itemTabs(o: { v1Run: boolean; extras: string[]; events: Record<string, any>[] }): string[] {
  const has = o.v1Run ? extraTabs(o.extras, o.events) : { board: false, qa: qaRows(o.events) !== null, diff: false, docs: false }
  return ["lanes", "map", "calls", "timeline", "chat", ...(has.board ? ["board"] : []), ...(has.qa ? ["qa"] : []), ...(has.diff ? ["diff"] : []), ...(has.docs ? ["docs"] : [])]
}

const LABEL: Record<string, string> = { lanes: "Lanes", map: "Map", calls: "Calls", timeline: "Timeline", chat: "Chat", board: "Board", qa: "QA", diff: "Diff", docs: "Docs" }

const Count = ({ n }: { n: number | null | undefined }) => (n ? <span className="ml-1 font-mono text-[10px] text-muted-foreground">{n}</span> : null)
const TaskCount = ({ id, refresh }: { id: string; refresh: number }) => <Count n={normaliseTasks(useExtra<unknown>("tasks", id, undefined, refresh).data).length} />
const DiffCount = ({ id, refresh }: { id: string; refresh: number }) => <Count n={normaliseDiff(useExtra<unknown>("diff", id, undefined, refresh).data).files.length} />

/** A tab the next task of the plan fills in for this kind of item. */
function Later({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{children}</p>
}

function Header({ d }: { d: ItemDetail }) {
  const s = d.summary
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <h1 className="min-w-0 flex-1 truncate text-lg font-bold tracking-tight" title={s.title}>
        {s.title || s.id}
      </h1>
      <span className="font-mono text-[11px] text-faint">
        {s.harness} · {s.kind}
        {s.branch ? ` · ${s.branch}` : ""}
      </span>
      <span className={cn("flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px]", s.live ? "border-running/40 text-running" : STATUS_TEXT[s.status])}>
        <StatusDot status={s.live && s.status !== "waiting" ? "working" : s.status} />
        {s.live ? (s.status === "waiting" ? "LIVE · needs you" : "LIVE") : STATUS_LABEL[s.status]}
      </span>
    </header>
  )
}

/** The item page: summary strip, tabs (Lanes default), and the right rail. Works for every source. */
export default function Item({ source, id, tab }: { source: string; id: string; tab: string }) {
  const [poll, setPoll] = useState(LIVE_POLL)
  const item = useItem(source, id, poll)
  const d = item.data
  const live = d?.summary.live ?? true
  useEffect(() => setPoll(live ? LIVE_POLL : IDLE_POLL), [live])
  const caps = useCapabilities()
  const sources = useSources()
  const isSession = d?.summary.kind === "session"
  // Sessions read health and findings from their calls (a run's come from its events).
  const calls = useCalls(source, isSession ? id : null, {}, poll)
  const now = useNow(5000)
  const [sheet, setSheet] = useState<string[] | null>(null)

  const src = sources.data?.find((s) => s.name === source)
  const actions = src?.actions ?? []
  const v1Run = !!d && d.summary.kind === "run" && caps.data?.adapter === source
  const events = useMemo(() => (Array.isArray(d?.events) ? d!.events : []), [d])
  const extras = useMemo(() => (d ? laneExtras(d) : new Map()), [d])
  const v1 = useMemo(() => {
    if (!d || !v1Run) return null
    const state = d.state ?? {}
    const graph = crewGraph(state, events)
    const stop = currentStop(state, events)
    return { state, stop, cards: crewCards(graph, state, events, d.summary.live, stop), refresh: runChanges(events) }
  }, [d, v1Run, events])

  if (item.loading && !d) return <Skeleton className="h-64 w-full" />
  if (!d)
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load {source} · {id}</AlertTitle>
        <AlertDescription>{item.error ?? "no such item"}</AlertDescription>
      </Alert>
    )

  const tabs = itemTabs({ v1Run, extras: src?.extras ?? caps.data?.extras ?? [], events })
  const current = tabs.includes(tab) ? tab : "lanes"
  const go = (t: string) => (location.hash = toHash({ view: "item", source, id, tab: t }))
  const lanesFor = (ids: string[] | null) => (ids ? d.lanes.filter((l) => ids.includes(l.id)) : [])
  const wide = current === "calls"
  const idea = String(d.state?.idea ?? d.summary.title ?? "")

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-4">
      <Header d={d} />
      <SummaryStrip detail={d} now={now} />
      <div className={cn("grid gap-6", !wide && "lg:grid-cols-[minmax(0,1fr)_320px]")}>
        <Tabs value={current} onValueChange={(v) => go(String(v))} className="min-w-0">
          <TabsList variant="line" className="border-b">
            {tabs.map((t) => (
              <TabsTrigger key={t} value={t}>
                {LABEL[t] ?? t}
                {t === "lanes" && <Count n={d.lanes.length} />}
                {t === "calls" && <Count n={d.summary.counts?.calls} />}
                {t === "board" && <TaskCount id={id} refresh={v1?.refresh ?? 0} />}
                {t === "qa" && <Count n={qaRows(events)?.length} />}
                {t === "diff" && <DiffCount id={id} refresh={v1?.refresh ?? 0} />}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="lanes" className="pt-4">
            <LaneCards lanes={d.lanes} extras={extras} now={now} onOpen={(lane) => setSheet([lane])} />
          </TabsContent>
          <TabsContent value="map" className="pt-4">
            <ItemMap detail={d} extras={extras} selected={sheet?.[0]} onOpen={setSheet} />
          </TabsContent>
          <TabsContent value="calls" className="pt-4">
            {current === "calls" && <Calls source={source} id={id} />}
          </TabsContent>
          <TabsContent value="timeline" className="pt-4">
            {v1Run ? <Trace runId={id} events={events} live={d.summary.live} idea={idea} /> : <Later>The timeline for {d.summary.kind}s arrives with the next task (Timeline and Chat for any item).</Later>}
          </TabsContent>
          <TabsContent value="chat" className="pt-4">
            {v1Run && v1 ? (
              <Thread runId={id} idea={idea} events={events} stop={v1.stop} cards={v1.cards} canSay={actions.includes("say")} />
            ) : (
              <Later>The transcript for {d.summary.kind}s arrives with the next task (Timeline and Chat for any item).</Later>
            )}
          </TabsContent>
          {tabs.includes("board") && v1 && (
            <TabsContent value="board" className="pt-4">
              <Board runId={id} cards={v1.cards} refresh={v1.refresh} />
            </TabsContent>
          )}
          {tabs.includes("qa") && (
            <TabsContent value="qa" className="pt-4">
              <Qa events={events} />
            </TabsContent>
          )}
          {tabs.includes("diff") && v1 && (
            <TabsContent value="diff" className="pt-4">
              <DiffView runId={id} refresh={v1.refresh} />
            </TabsContent>
          )}
          {tabs.includes("docs") && v1 && (
            <TabsContent value="docs" className="pt-4">
              <Docs runId={id} state={v1.state} />
            </TabsContent>
          )}
        </Tabs>
        {!wide && (
          <div className="flex flex-col gap-4 lg:sticky lg:top-0 lg:self-start">
            <RightRail detail={d} calls={isSession ? calls.data : null} actions={actions} now={now} onActed={item.reload} onOpen={(lane) => setSheet([lane])} />
            {v1Run && (src?.extras ?? []).includes("tokens") && !tabs.includes("docs") && <TokenPanel runId={id} optional />}
          </div>
        )}
      </div>
      <LaneSheet detail={d} lanes={lanesFor(sheet)} onClose={() => setSheet(null)} />
    </div>
  )
}
