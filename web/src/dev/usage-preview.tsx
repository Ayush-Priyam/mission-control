// Dev-only: renders the Usage page alone (`npx vite web`, open /usage-preview.html). Not in the production build.
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@fontsource/archivo/400.css"
import "@fontsource/archivo/600.css"
import "@fontsource/archivo/800.css"
import "@fontsource/space-mono/400.css"
import "@fontsource/space-mono/700.css"
import "../styles/globals.css"
import { Usage, type TableTab } from "../views/Usage"
import type { Range } from "../lib/usage-api"

const q = new URLSearchParams(location.search)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Usage initialRange={(q.get("range") as Range) ?? undefined} initialTable={(q.get("table") as TableTab) ?? undefined} />
  </StrictMode>,
)
