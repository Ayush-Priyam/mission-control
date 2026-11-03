// Notifications on the phone page (opt-in): ask permission, subscribe through the service worker with
// this server's VAPID key, and register the subscription for this device. Pings carry no content.

export type PushState = "unsupported" | "needs-install" | "denied" | "off" | "on"

type Env = { nav: Navigator; win: typeof window; fetch: typeof fetch }
const real = (): Env => ({ nav: navigator, win: window, fetch: (...a) => fetch(...a) })

const standalone = (e: Env) => e.win.matchMedia?.("(display-mode: standalone)").matches || (e.nav as Navigator & { standalone?: boolean }).standalone === true
const ios = (e: Env) => /iPhone|iPad|iPod/.test(e.nav.userAgent)

export async function pushState(e: Env = real()): Promise<PushState> {
  // iOS only offers Web Push to a page added to the Home Screen.
  if (!("serviceWorker" in e.nav) || !("PushManager" in e.win) || !("Notification" in e.win)) return ios(e) && !standalone(e) ? "needs-install" : "unsupported"
  if (e.win.Notification.permission === "denied") return "denied"
  const reg = await e.nav.serviceWorker.getRegistration("/")
  const sub = await reg?.pushManager.getSubscription()
  return sub && e.win.Notification.permission === "granted" ? "on" : "off"
}

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64url.length % 4)) % 4))
  const out = new Uint8Array(new ArrayBuffer(s.length))
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

/** Must run from a tap (iOS asks for permission only on a user gesture). Resolves with the new state. */
export async function enablePush(e: Env = real()): Promise<PushState> {
  const perm = await e.win.Notification.requestPermission()
  if (perm !== "granted") return perm === "denied" ? "denied" : "off"
  const k = await e.fetch("/api/remote/push/key", { credentials: "same-origin" })
  if (!k.ok) throw new Error("could not get the server's key")
  const { publicKey } = await k.json()
  const reg = await e.nav.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }))
  const r = await e.fetch("/api/remote/push/subscribe", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) })
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "the server refused the subscription")
  return "on"
}

export async function disablePush(e: Env = real()): Promise<PushState> {
  const reg = await e.nav.serviceWorker.getRegistration("/")
  await (await reg?.pushManager.getSubscription())?.unsubscribe()
  await e.fetch("/api/remote/push/unsubscribe", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}" })
  return "off"
}
