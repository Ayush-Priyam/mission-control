import { useEffect, useMemo, useState } from "react"
import { useExtra } from "@/lib/api"
import { Markdown } from "@/components/Markdown"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { images, laneFilter, sections, type Section } from "@/lib/workbench"
import Qa from "@/views/Qa"
import DiffView from "@/views/Diff"

const CUT = 200_000
const rawUrl = (runId: string, path: string) => `/api/x/raw/${encodeURIComponent(runId)}?path=${encodeURIComponent(path)}`

function RawText({ runId, path }: { runId: string; path: string }) {
  const [text, setText] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setText(null); setErr(null)
    fetch(rawUrl(runId, path)).then(
      (r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))),
    ).then((t) => !cancelled && setText(t), (e) => !cancelled && setErr(String(e.message ?? e)))
    return () => { cancelled = true }
  }, [runId, path])
  if (err) return <p className="font-mono text-xs text-failed">Could not read {path} ({err}).</p>
  if (text === null) return <Skeleton className="h-32 w-full" />
  return <Markdown text={text.length > CUT ? `${text.slice(0, CUT)}\n\n… cut at 200k characters` : text} />
}

function Body({ runId, k, s, art, events }: { runId: string; k: string; s: Section; art: string[]; events: Record<string, any>[] }) {
  const keep = useMemo(() => laneFilter(k), [k])
  switch (s.kind) {
    case "note": return <p className="text-[13px] text-muted-foreground">{s.text}</p>
    case "md": return <RawText runId={runId} path={s.path} />
    case "qa": return <Qa events={events} />
    case "diff": return <DiffView runId={runId} keep={keep} label={`${k} files, guessed from paths`} />
    case "device": return <img src={rawUrl(runId, s.path)} alt="App on device" className="max-h-[60vh] rounded-lg border" />
    case "gallery":
      return (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {images(art, s.prefix).map((p) => (
            <figure key={p} className="flex flex-col gap-1">
              <img loading="lazy" src={rawUrl(runId, p)} alt={p.split("/").pop()} className="rounded-lg border" />
              <figcaption className="truncate font-mono text-[11px] text-muted-foreground">{p.replace(s.prefix, "")}</figcaption>
            </figure>
          ))}
        </div>
      )
  }
}

/** What one agent made: notes, designs, code, its last session. Only drawn when the adapter has an `artifacts` extra. */
export function Workbench({ runId, agent, events }: { runId: string; agent: string; events: Record<string, any>[] }) {
  const r = useExtra<string[]>("artifacts", runId)
  const art = useMemo(() => (Array.isArray(r.data) ? r.data : []), [r.data])
  const secs = useMemo(() => sections(agent, art), [agent, art])
  const [tab, setTab] = useState(0)
  useEffect(() => setTab(0), [agent])
  if (r.loading && !r.data) return <Skeleton className="h-32 w-full" />
  const cur = Math.min(tab, secs.length - 1)
  return (
    <section aria-label="Workbench" className="rounded-xl border bg-card p-3">
      <Tabs value={String(cur)} onValueChange={(v) => setTab(Number(v))}>
        <TabsList>{secs.map((s, i) => <TabsTrigger key={s.title} value={String(i)}>{s.title}</TabsTrigger>)}</TabsList>
        {secs.map((s, i) => (
          <TabsContent key={s.title} value={String(i)} className="pt-3">
            {i === cur && <Body runId={runId} k={agent} s={s} art={art} events={events} />}
          </TabsContent>
        ))}
      </Tabs>
    </section>
  )
}
