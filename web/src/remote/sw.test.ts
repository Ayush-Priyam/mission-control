import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

type Handler = (e: any) => void

/** Evaluate public/sw.js against a fake service-worker scope with a fake Cache. */
function boot(netFail = false) {
  const handlers: Record<string, Handler> = {}
  const store = new Map<string, any>()
  const puts: string[] = []
  const key = (r: any) => (typeof r === "string" ? r : new URL(r.url).pathname)
  const cache = {
    add: async (u: string) => void store.set(u, { url: u }),
    put: async (r: any, res: any) => void (puts.push(key(r)), store.set(key(r), res)),
    match: async (r: any) => store.get(key(r)),
  }
  const caches = {
    open: async () => cache,
    keys: async () => [],
    delete: async () => true,
    match: async (r: any) => store.get(key(r)),
  }
  const fetched: string[] = []
  const fetchFn = async (r: any) => {
    fetched.push(key(r))
    if (netFail) throw new TypeError("offline")
    return { ok: true, url: r.url, clone() { return this } }
  }
  const self = {
    location: { origin: "https://laptop.tail1.ts.net" },
    addEventListener: (n: string, h: Handler) => (handlers[n] = h),
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  }
  const src = readFileSync(path.join(import.meta.dirname, "../../public/sw.js"), "utf8")
  new Function("self", "caches", "fetch", "Response", src)(self, caches, fetchFn, { error: () => "ERR" })
  const fire = (url: string, init: { method?: string; mode?: string } = {}) => {
    let responded: Promise<any> | null = null
    handlers.fetch({
      request: { url: `https://laptop.tail1.ts.net${url}`, method: init.method ?? "GET", mode: init.mode ?? "cors" },
      respondWith: (p: Promise<any>) => (responded = p),
    })
    return responded as Promise<any> | null
  }
  return { fire, puts, fetched, store, handlers }
}

describe("service worker", () => {
  it("never touches /api/ requests: no respondWith, nothing cached", async () => {
    const sw = boot()
    for (const u of ["/api/remote/prompts", "/api/remote/events", "/api/remote/me"]) {
      expect(sw.fire(u)).toBeNull()
    }
    expect(sw.puts.some((p) => p.startsWith("/api/"))).toBe(false)
  })

  it("never touches a POST (answers are never queued or replayed)", () => {
    const sw = boot()
    expect(sw.fire("/api/remote/answer", { method: "POST" })).toBeNull()
    expect(sw.fire("/", { method: "POST", mode: "navigate" })).toBeNull()
  })

  it("serves /assets/ cache-first and stores a miss", async () => {
    const sw = boot()
    await sw.fire("/assets/app-1.js")
    expect(sw.puts).toContain("/assets/app-1.js")
    sw.fetched.length = 0
    await sw.fire("/assets/app-1.js")
    expect(sw.fetched).toEqual([])
  })

  it("navigation is network-first and falls back to the cached shell offline", async () => {
    const ok = boot()
    await ok.fire("/", { mode: "navigate" })
    expect(ok.puts).toContain("/")
    const off = boot(true)
    off.store.set("/", "SHELL")
    expect(await off.fire("/pair", { mode: "navigate" })).toBe("SHELL")
  })

  it("precaches the shell on install", async () => {
    const sw = boot()
    let done: Promise<any> = Promise.resolve()
    sw.handlers.install({ waitUntil: (p: Promise<any>) => (done = p) })
    await done
    expect(sw.store.has("/")).toBe(true)
  })
})
