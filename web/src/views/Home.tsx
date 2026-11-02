import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { StageBar } from "@/components/StageBar"
import { useCapabilities, type RunSummary } from "@/lib/api"
import { isWaiting, repoName, useSharedRuns } from "@/lib/runs-context"
import { toHash } from "@/lib/route"

export function RunStatusBadge({ run }: { run: RunSummary }) {
  if (isWaiting(run)) return <Badge className="bg-needs-you/15 text-needs-you">Waiting on you</Badge>
  if (run.live) return <Badge className="bg-running/15 text-running">Live</Badge>
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
            <span className="truncate font-mono text-[11px] text-muted-foreground">{run.id}</span>
            <RunStatusBadge run={run} />
          </div>
        </CardContent>
      </Card>
    </a>
  )
}

export default function Home() {
  const runs = useSharedRuns()
  const caps = useCapabilities()

  if (runs.loading) return <Skeleton className="h-32 w-full" />
  if (runs.error && !runs.data)
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load runs</AlertTitle>
        <AlertDescription>{runs.error}</AlertDescription>
      </Alert>
    )
  const list = runs.data ?? []
  if (!list.length) {
    const dir = caps.data?.source ?? "the runs directory"
    return (
      <Alert>
        <AlertTitle>No runs yet</AlertTitle>
        <AlertDescription>
          No runs found in {dir}. Start with <code className="font-mono">mission-control --runs {dir}</code>.
        </AlertDescription>
      </Alert>
    )
  }

  const groups = new Map<string, RunSummary[]>()
  for (const r of list) {
    const k = repoName(r.repo) || "Runs"
    groups.set(k, [...(groups.get(k) ?? []), r])
  }
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      {[...groups].map(([name, rs]) => (
        <section key={name} className="flex flex-col gap-3">
          <h2 className="flex items-baseline gap-2 text-sm font-extrabold tracking-tight">
            {name === "Runs" ? (
              name
            ) : (
              <a href={toHash({ view: "repo", repo: name })} className="hover:underline">
                {name}
              </a>
            )}
            <span className="font-mono text-[11px] font-normal text-muted-foreground">{rs.length}</span>
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rs.map((r) => (
              <RunCard key={r.id} run={r} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
