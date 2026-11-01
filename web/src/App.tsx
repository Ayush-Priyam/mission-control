import { useEffect, useState } from "react"
import { Shell } from "@/components/Shell"
import Home from "@/views/Home"
import Project from "@/views/Project"
import Run from "@/views/Run"
import Agent from "@/views/Agent"
import { RunsProvider } from "@/lib/runs-context"
import { parseRoute, type Route } from "@/lib/route"

function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash))
  useEffect(() => {
    const on = () => setRoute(parseRoute(location.hash))
    window.addEventListener("hashchange", on)
    return () => window.removeEventListener("hashchange", on)
  }, [])
  return route
}

export default function App() {
  const route = useRoute()
  return (
    <RunsProvider>
      <Shell route={route}>
        {route.view === "home" && <Home />}
        {route.view === "project" && <Project key={route.repo} repo={route.repo} />}
        {route.view === "run" && <Run key={route.id} id={route.id} tab={route.tab} />}
        {route.view === "agent" && <Agent key={`${route.id}/${route.stage}`} id={route.id} stage={route.stage} />}
      </Shell>
    </RunsProvider>
  )
}
