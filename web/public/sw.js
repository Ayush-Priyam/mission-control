// Mission Control phone page: a static-shell service worker.
// /api/* goes straight to the network: never cached, never queued, never replayed (contract C22).
const CACHE = "mc-remote-shell-v1"
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"]

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener("fetch", (event) => {
  const req = event.request
  if (req.method !== "GET") return // POSTs (answers) are never touched
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith("/api/")) return // network only: no respondWith, so nothing is cached or replayed

  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.open(CACHE).then(async (c) => {
        const hit = await c.match(req)
        if (hit) return hit
        const res = await fetch(req)
        if (res && res.ok) await c.put(req, res.clone())
        return res
      }),
    )
    return
  }

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then(async (res) => {
          if (res && res.ok && url.pathname === "/") {
            const c = await caches.open(CACHE)
            await c.put("/", res.clone())
          }
          return res
        })
        .catch(async () => (await caches.match("/")) || Response.error()),
    )
  }
})

// Notifications. A push carries no content: fetch what is waiting from this server (over the tailnet,
// with the device cookie) and show it. iOS requires a visible notification for every push.
self.addEventListener("push", (event) => {
  event.waitUntil(
    fetch("/api/remote/prompts", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { prompts: [] }))
      .catch(() => ({ prompts: [] }))
      .then(({ prompts = [] }) => {
        const p = prompts.find((x) => x.answerable) ?? prompts[0]
        const what = p ? [p.tool, p.target].filter(Boolean).join(" · ") || p.title : ""
        const n = prompts.filter((x) => x.answerable).length
        return self.registration.showNotification(n > 1 ? `Needs you (${n})` : "Needs you", {
          body: what ? `${p.title ? `${p.title}: ` : ""}${what}`.slice(0, 180) : "A prompt is waiting",
          tag: "mc-needs-you",
          renotify: true,
          icon: "/icons/icon-192.png",
          badge: "/icons/icon-192.png",
          data: { url: "/" },
        })
      }),
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => new URL(c.url).origin === self.location.origin)
      return open ? open.focus() : self.clients.openWindow("/")
    }),
  )
})
