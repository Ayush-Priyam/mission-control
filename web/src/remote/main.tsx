import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "../styles/globals.css"
import { RemoteApp } from "./RemoteApp"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RemoteApp />
  </StrictMode>,
)

// The service worker only caches the static shell; it never caches or replays /api/* (see public/sw.js).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {})
  })
}
