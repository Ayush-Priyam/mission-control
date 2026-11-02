import { useEffect, useState } from "react"
import { Shell } from "@/components/Shell"
import Home from "@/views/Home"
import Project from "@/views/Project"
import ProjectPage from "@/views/ProjectPage"
import Item from "@/views/Item"
import { Usage } from "@/views/Usage"
import Agent from "@/views/Agent"
import { useCapabilities } from "@/lib/api"
import { ProjectsProvider } from "@/lib/projects-context"
import { parseRoute, toHash, type Route } from "@/lib/route"

function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash))
  useEffect(() => {
    const on = () => setRoute(parseRoute(location.hash))
    window.addEventListener("hashchange", on)
    return () => window.removeEventListener("hashchange", on)
  }, [])
  return route
}

/** A v1 run link (#/run/<id>/<tab>) opens the same run on the item page of the v1 adapter's source. */
function RunRedirect({ id, tab }: { id: string; tab: string }) {
  const caps = useCapabilities()
  const source = caps.data?.adapter
  useEffect(() => {
    if (source) location.replace(toHash({ view: "item", source, id, tab: tab === "trace" ? "timeline" : tab }))
  }, [source, id, tab])
  return null
}

function Page({ route }: { route: Route }) {
  switch (route.view) {
    case "home":
      return <Home />
    case "usage":
      return <Usage />
    case "project":
      return <ProjectPage key={route.key} projectKey={route.key} />
    case "worktree":
      return <ProjectPage key={`${route.key}|${route.path}`} projectKey={route.key} worktree={route.path} />
    case "item":
      return <Item key={`${route.source}/${route.id}`} source={route.source} id={route.id} tab={route.tab} call={route.call} />
    case "run":
      return <RunRedirect id={route.id} tab={route.tab} />
    case "agent":
      return <Agent key={`${route.id}/${route.stage}`} id={route.id} stage={route.stage} />
    case "repo":
      return <Project key={route.repo} repo={route.repo} />
  }
}

export default function App() {
  const route = useRoute()
  return (
    <ProjectsProvider>
      <Shell route={route}>
        <Page route={route} />
      </Shell>
    </ProjectsProvider>
  )
}
