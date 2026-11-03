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
