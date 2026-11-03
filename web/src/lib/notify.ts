import { useEffect } from "react"
import { onServerNotify, setServerNotify } from "@/lib/server-events"

const supported = () => typeof window !== "undefined" && "Notification" in window

export const notifyPermission = (): NotificationPermission | "unsupported" => (supported() ? Notification.permission : "unsupported")

const granted = () => notifyPermission() === "granted"

/** Ask the browser for notification permission (needs a click); once granted, the event stream asks for them. */
export async function askNotifyPermission() {
  if (!supported()) return "unsupported"
  const p = await Notification.requestPermission()
  setServerNotify(granted)
  return p
}

type Payload = { title: string; subtitle?: string; message?: string; url?: string; group?: string }

function show(m: Payload) {
  if (!granted()) return
  const n = new Notification(m.subtitle ? `${m.title}: ${m.subtitle}` : m.title, { body: m.message ?? "", tag: m.group })
  n.onclick = () => {
    window.focus()
    if (m.url) location.hash = m.url
    n.close()
  }
}

/**
 * While notifications are allowed, the page's event stream asks for them and each one is shown; a click
 * brings this tab forward on that session. Otherwise the page does not ask, so the server falls back to macOS.
 */
export function useNeedsYouNotifications() {
  useEffect(() => {
    setServerNotify(granted)
    const off = onServerNotify((d) => {
      try { show(d as Payload) } catch { /* a bad event must not stop the next */ }
    })
    return () => {
      off()
      setServerNotify(() => false)
    }
  }, [])
}
