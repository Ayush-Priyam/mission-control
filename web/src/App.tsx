import { useEffect, useState } from "react"
import { Shell } from "@/components/Shell"
import Home from "@/views/Home"
import Project from "@/views/Project"
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
        {(route.view === "run" || route.view === "agent") && (
          <p className="font-mono text-sm text-muted-foreground">{route.view} view: coming in a later task</p>
        )}
      </Shell>
    </RunsProvider>
  )
}
