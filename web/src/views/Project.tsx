import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { BrainCanvas, type BrainData } from "@/components/BrainCanvas"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StageBar } from "@/components/StageBar"
import { useCapabilities, useCrew, useExtra, useRuns, type RunSummary } from "@/lib/api"
import { isWaiting, repoName } from "@/lib/runs-context"
import { toHash } from "@/lib/route"

export function RunStatusBadge({ run }: { run: RunSummary }) {
  if (isWaiting(run)) return <Badge className="bg-needs-you/15 text-needs-you">needs you</Badge>
  if (run.live) return <Badge className="bg-running/15 text-running">working</Badge>
  return <Badge variant="outline">Ended</Badge>
}

export function RunCard({ run }: { run: RunSummary }) {
  return (
    <a href={toHash({ view: "run", id: run.id, tab: "map" })} className="block rounded-xl focus-visible:outline-2">
      <Card className="h-full transition-colors hover:bg-muted/40">
        <CardHeader>
          <CardTitle className="line-clamp-2 text-sm font-semibold">{run.idea || run.id}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <StageBar stages={run.stages} />
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-mono text-xs text-muted-foreground">{run.id}</span>
            <RunStatusBadge run={run} />
          </div>
        </CardContent>
      </Card>
    </a>
  )
}

type CrewRow = { stage: string; sessions: number; tokens: number; cost: number; rounds: number; stops: number; raised: number; models: string[] }

function Crew({ repo }: { repo: string }) {
  const crew = useCrew(repo)
  if (crew.loading) return <Skeleton className="h-32 w-full" />
  if (crew.error) return <Alert variant="destructive"><AlertTitle>Could not load crew</AlertTitle><AlertDescription>{crew.error}</AlertDescription></Alert>
  const rows: CrewRow[] = Object.values(crew.data?.crew ?? {})
  const bounces = Object.entries<number>(crew.data?.bounces ?? {})
  if (!rows.length) return <p className="font-mono text-sm text-muted-foreground">No agent activity recorded yet.</p>
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Agent</TableHead>
            <TableHead className="text-right">Rounds</TableHead>
            <TableHead className="text-right">Sessions</TableHead>
            <TableHead className="text-right">Stops</TableHead>
            <TableHead className="text-right">Raised</TableHead>
            <TableHead className="text-right">Tokens</TableHead>
            <TableHead className="text-right">Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.stage}>
              <TableCell className="font-mono font-medium">{r.stage}</TableCell>
              <TableCell className="text-right font-mono">{r.rounds}</TableCell>
              <TableCell className="text-right font-mono">{r.sessions}</TableCell>
              <TableCell className="text-right font-mono">{r.stops}</TableCell>
              <TableCell className="text-right font-mono">{r.raised}</TableCell>
              <TableCell className="text-right font-mono">{r.tokens.toLocaleString()}</TableCell>
              <TableCell className="text-right font-mono">${r.cost.toFixed(2)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <aside>
        <h3 className="mb-2 font-mono text-xs uppercase tracking-widest text-muted-foreground">Bounces</h3>
        {bounces.length ? (
          <ul className="flex flex-col gap-1 font-mono text-xs">
            {bounces.map(([k, n]) => {
              const [from, to] = k.split(">")
              return (
                <li key={k} className="flex justify-between border-b py-1">
                  <span>{from} → {to}</span>
                  <span className="text-muted-foreground">{n}</span>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No bounces.</p>
        )}
      </aside>
    </div>
  )
}

function Brain({ repo }: { repo: string }) {
  const p = useExtra<any>("project", repo)
  if (p.loading) return <Skeleton className="h-96 w-full" />
  const brain: BrainData | undefined = p.data?.brain ?? (p.data?.nodes ? p.data : undefined)
  if (p.error || !brain?.nodes?.length)
    return <p className="font-mono text-sm text-muted-foreground">{p.error ?? "Nothing remembered about this project yet."}</p>
  return <BrainCanvas data={brain} />
}

export default function Project({ repo }: { repo: string }) {
  const runs = useRuns() // the /api/runs poll runs only while this legacy view is open
  const caps = useCapabilities()
  const mine = (runs.data ?? []).filter((r) => repoName(r.repo) === repo)
  const hasBrain = !!caps.data && caps.data.extras.includes("project")
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <h1 className="text-lg font-extrabold tracking-tight">{repo}</h1>
      <Tabs defaultValue="crew">
        <TabsList>
          <TabsTrigger value="crew">Crew</TabsTrigger>
          <TabsTrigger value="runs">Runs <span className="font-mono text-xs opacity-60">{mine.length}</span></TabsTrigger>
          {hasBrain && <TabsTrigger value="brain">Brain</TabsTrigger>}
        </TabsList>
        <TabsContent value="crew"><Crew repo={repo} /></TabsContent>
        <TabsContent value="runs">
          {mine.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{mine.map((r) => <RunCard key={r.id} run={r} />)}</div>
          ) : (
            <p className="font-mono text-sm text-muted-foreground">No runs for {repo}.</p>
          )}
        </TabsContent>
        {hasBrain && <TabsContent value="brain"><Brain repo={repo} /></TabsContent>}
      </Tabs>
    </div>
  )
}
