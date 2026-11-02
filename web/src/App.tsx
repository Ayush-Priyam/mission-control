import { useEffect, useState, type ReactNode } from "react"
import { Shell } from "@/components/Shell"
import Home from "@/views/Home"
import Project from "@/views/Project"
import Run from "@/views/Run"
import Agent from "@/views/Agent"
import { RunsProvider, useSharedRuns, repoName } from "@/lib/runs-context"
import { ProjectsProvider, useShared } from "@/lib/projects-context"
import { parseRoute, toHash, TABS, type Route, type Tab } from "@/lib/route"

function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash))
  useEffect(() => {
    const on = () => setRoute(parseRoute(location.hash))
    window.addEventListener("hashchange", on)
    return () => window.removeEventListener("hashchange", on)
  }, [])
  return route
}

/** A page a later task of the v2 plan fills in; says which. */
function Pending({ task, title, children }: { task: string; title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed p-4">
      <div className="font-mono text-[11px] tracking-wider text-faint uppercase">{task}</div>
      <div className="mt-1 text-sm font-medium">{title}</div>
      {children && <div className="mt-2 text-xs text-muted-foreground">{children}</div>}
    </div>
  )
}

/** v1 run tab for a v2 item tab, while the v1 Run page stands in for the item page. */
const v1Tab = (tab: string): Tab => (tab === "timeline" ? "trace" : TABS.includes(tab as Tab) ? (tab as Tab) : "map")

function Item({ source, id, tab }: { source: string; id: string; tab: string }) {
  const runs = useSharedRuns()
  if (runs.data?.some((r) => r.id === id)) return <Run key={id} id={id} tab={v1Tab(tab)} />
  return (
    <Pending task="Tasks 8–10" title={`Item page for ${source} · ${id}`}>
      Lanes, calls, timeline and chat for this item arrive with the v2 item page.
    </Pending>
  )
}

function ProjectPending({ projectKey }: { projectKey: string }) {
  const { projects } = useShared()
  const runs = useSharedRuns()
  const name = projects.data?.find((p) => p.key === projectKey)?.name
  const v1 = name && runs.data?.some((r) => repoName(r.repo) === name)
  return (
    <Pending task="Task 7" title={`Project page${name ? ` for ${name}` : ""}`}>
      Worktree cards and this project's runs and sessions.
      {v1 && (
        <>
          {" "}
          Meanwhile:{" "}
          <a className="underline hover:text-foreground" href={toHash({ view: "repo", repo: name })}>
            v1 project page
          </a>
          .
        </>
      )}
    </Pending>
  )
}

function Page({ route }: { route: Route }) {
  switch (route.view) {
    case "home":
      return (
        <div className="flex flex-col gap-6">
          <Pending task="Task 7" title="Home: needs-you queue, live activity, recent runs and sessions" />
          <Home />
        </div>
      )
    case "usage":
      return <Pending task="Task 11" title="Usage: totals, split by model and harness, heatmap, daily and per-project tables" />
    case "project":
      return <ProjectPending key={route.key} projectKey={route.key} />
    case "worktree":
      return <Pending task="Task 7" title={`Worktree ${route.path}`}>Its runs and sessions, filtered from the project page.</Pending>
    case "item":
      return <Item key={`${route.source}/${route.id}`} source={route.source} id={route.id} tab={route.tab} />
    case "run":
      return <Run key={route.id} id={route.id} tab={route.tab} />
    case "agent":
      return <Agent key={`${route.id}/${route.stage}`} id={route.id} stage={route.stage} />
    case "repo":
      return <Project key={route.repo} repo={route.repo} />
  }
}

export default function App() {
  const route = useRoute()
  return (
    <RunsProvider>
      <ProjectsProvider>
        <Shell route={route}>
          <Page route={route} />
        </Shell>
      </ProjectsProvider>
    </RunsProvider>
  )
}
