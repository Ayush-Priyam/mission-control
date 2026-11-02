// Dev-only: renders the Calls tab for ?source=&id= until the item page routes to it.
import { createRoot } from "react-dom/client"
import "@fontsource/archivo/400.css"
import "@fontsource/archivo/600.css"
import "@fontsource/space-mono/400.css"
import "../styles/globals.css"
import Calls from "@/views/Calls"

const q = new URLSearchParams(location.search)
const source = q.get("source") ?? "claude-code"
const id = q.get("id") ?? ""

createRoot(document.getElementById("root")!).render(
  <div className="flex h-screen flex-col p-6">
    <div className="mb-3 font-mono text-xs text-muted-foreground">
      {source} / {id} / calls
    </div>
    <div className="min-h-0 flex-1 overflow-hidden rounded-xl border">
      <Calls source={source} id={id} />
    </div>
  </div>,
)
