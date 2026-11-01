import { useEffect, useState } from "react"
import { Shell } from "@/components/Shell"
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
    <Shell route={route}>
      <p className="font-mono text-sm text-muted-foreground">
        {route.view} view: coming in a later task
      </p>
    </Shell>
  )
}
