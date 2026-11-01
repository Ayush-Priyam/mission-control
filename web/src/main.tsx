import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@fontsource/archivo/400.css"
import "@fontsource/archivo/500.css"
import "@fontsource/archivo/600.css"
import "@fontsource/archivo/800.css"
import "@fontsource/space-mono/400.css"
import "@fontsource/space-mono/700.css"
import "./styles/globals.css"
import App from "./App"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
