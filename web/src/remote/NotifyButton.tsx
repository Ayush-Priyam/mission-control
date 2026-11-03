import { useEffect, useState } from "react"
import { disablePush, enablePush, pushState, type PushState } from "@/lib/push"

const HINT: Partial<Record<PushState, string>> = {
  "needs-install": "For notifications, add this page to your Home Screen (Share → Add to Home Screen) and open it from there.",
  denied: "Notifications are blocked for this app. Allow them in Settings → Notifications.",
}

/** "Turn on notifications" for this device. Hidden where the browser cannot do Web Push at all. */
export function NotifyButton({ state: initial }: { state?: PushState }) {
  const [state, setState] = useState<PushState | null>(initial ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (initial) return
    pushState().then(setState, () => setState("unsupported"))
  }, [initial])

  if (!state || state === "unsupported") return null
  if (HINT[state]) return <p className="rounded-xl border bg-card p-3 text-sm text-muted-foreground">{HINT[state]}</p>
  const toggle = async () => {
    setBusy(true)
    setError(null)
    try { setState(state === "on" ? await disablePush() : await enablePush()) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  return (
    <div className="flex flex-col gap-1">
      <button type="button" onClick={toggle} disabled={busy} className="min-h-12 rounded-xl border px-4 text-base font-medium">
        {state === "on" ? "Notifications on · turn off" : "Turn on notifications"}
      </button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
