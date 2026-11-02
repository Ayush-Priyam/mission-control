import { createServer as createHttpServer } from "node:http"
import { existsSync } from "node:fs"
import { readFile, realpath } from "node:fs/promises"
import { dirname, extname, join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { isRunId, isSessionName } from "./names.mjs"
import { crewStats } from "./crew.mjs"
import { fromAdapter } from "./sources/from-adapter.mjs"
import { createRegistry } from "./sources/registry.mjs"

const DEFAULT_DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist")

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".map": "application/json; charset=utf-8",
}

function json(res, body, status = 200) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
  res.end(JSON.stringify(body))
}

async function serveStatic(res, distDir, pathname) {
  let rel
  try {
    rel = decodeURIComponent(pathname)
  } catch {
    return json(res, { error: "bad request" }, 400)
  }
  if (rel.includes("\0")) return json(res, { error: "bad request" }, 400)
  const root = resolve(distDir)
  const target = resolve(root, "." + (rel === "/" ? "/index.html" : rel))
  if (target !== root && !target.startsWith(root + sep)) return json(res, { error: "bad request" }, 400)
  try {
    const real = await realpath(target)
    const realRoot = await realpath(root)
    if (!real.startsWith(realRoot + sep)) return json(res, { error: "bad request" }, 400)
    const body = await readFile(real)
    res.writeHead(200, { "content-type": TYPES[extname(real)] ?? "application/octet-stream" })
    res.end(body)
  } catch {
    json(res, { error: "not found" }, 404)
  }
}

const notFound = (res) => json(res, { error: "not found" }, 404)
const MAX_BODY = 64 * 1024

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > MAX_BODY) throw { status: 413, message: "body too large" }
    chunks.push(c)
  }
  const text = Buffer.concat(chunks).toString("utf8")
  if (!text.trim()) return {}
  try { return JSON.parse(text) } catch { throw { status: 400, message: "bad json" } }
}

// Extras ids are not always run ids (project uses a repo basename such as "my.app").
const isExtrasId = (s) => typeof s === "string" && /^[\w.-]+$/.test(s) && s !== "." && s !== ".."

const decode = (s) => { try { return decodeURIComponent(s) } catch { return null } }

// Source names and item ids: path-safe words only (no separators, no "." or "..").
const isKey = isExtrasId

async function sendExtra(res, r) {
  const status = r.status ?? 200
  if (r.type && !/json/i.test(r.type)) {
    res.writeHead(status, { "content-type": r.type, "cache-control": "no-store", "x-content-type-options": "nosniff" })
    return res.end(r.body)
  }
  return json(res, r.body, status)
}

// v2 routes, one set for every source: /api/overview, /api/items, /api/item/:source/:id[/...]
async function apiV2(registry, req, res, url, parts) {
  const get = req.method === "GET" || req.method === "HEAD"
  if (get && parts[0] === "sources" && parts.length === 1) {
    return json(res, registry.sources().map((s) => ({
      name: s.name, harness: s.harness, extras: Object.keys(s.extras ?? {}), actions: Object.keys(s.actions ?? {}), source: s.describe?.().source ?? null,
    })))
  }
  if (get && parts[0] === "overview" && parts.length === 1) return json(res, await registry.overview())
  if (get && parts[0] === "items" && parts.length === 1) return json(res, await registry.list())
  if (parts[0] !== "item" || parts.length < 3) return false
  const source = decode(parts[1]), id = decode(parts[2])
  if (!isKey(source) || !isKey(id)) return json(res, { error: "not allowed" }, 400)
  const src = registry.source(source)
  if (!src) return json(res, { error: "no such source" }, 404)
  if (get && parts.length === 3) {
    const item = await registry.get(source, id)
    return item ? json(res, item) : json(res, { error: "no such item" }, 404)
  }
  if (get && parts[3] === "calls" && parts.length === 4) {
    const q = url.searchParams
    return json(res, await registry.calls(source, id, { lane: q.get("lane") ?? undefined, kind: q.get("kind") ?? undefined, q: q.get("q") ?? undefined }))
  }
  if (get && parts[3] === "session" && parts.length === 5) {
    const name = decode(parts[4])
    if (!isSessionName(name)) return json(res, { error: "not allowed" }, 400)
    const s = await registry.session(source, id, name)
    return s ? json(res, s) : json(res, { error: "not found" }, 404)
  }
  if (get && parts[3] === "x" && parts.length === 5) {
    const key = decode(parts[4])
    const fn = Object.hasOwn(src.extras ?? {}, key) ? src.extras[key] : null
    if (!fn) return notFound(res)
    return sendExtra(res, await fn(id, url.searchParams))
  }
  if (req.method === "POST" && parts[3] === "action" && parts.length === 5) {
    const name = decode(parts[4])
    const fn = Object.hasOwn(src.actions ?? {}, name) ? src.actions[name] : null
    if (!fn) return notFound(res)
    const raw = await readBody(req)
    const body = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}
    return json(res, (await fn(id, body)) ?? {})
  }
  return false
}

async function api({ adapter, registry }, req, res, url) {
  const parts = url.pathname.split("/").slice(2) // after "/api"
  const get = req.method === "GET" || req.method === "HEAD"
  try {
    if ((await apiV2(registry, req, res, url, parts)) !== false) return
    // v1 routes below: aliases for the first adapter-backed source.
    if (!adapter) return notFound(res)
    if (get && parts[0] === "runs" && parts.length === 1) return json(res, await adapter.listRuns())
    if (get && parts[0] === "run" && parts.length === 2) {
      const id = decode(parts[1])
      const run = isRunId(id) ? await adapter.getRun(id) : null
      return run ? json(res, run) : json(res, { error: "no such run" }, 404)
    }
    if (get && parts[0] === "run" && parts[2] === "session" && parts.length === 4) {
      const id = decode(parts[1]), name = decode(parts[3])
      if (!isRunId(id) || !isSessionName(name)) return json(res, { error: "not allowed" }, 400)
      const s = await adapter.getSession(id, name)
      return s ? json(res, s) : json(res, { error: "not found" }, 404)
    }
    if (get && parts[0] === "crew" && parts.length === 1) {
      const repo = url.searchParams.get("repo")
      const base = (p) => String(p ?? "").split(/[\\/]/).filter(Boolean).pop()
      const runs = (await adapter.listRuns()).filter((r) => repo == null || base(r.repo) === repo)
      const full = (await Promise.all(runs.map((r) => adapter.getRun(r.id)))).map((d, i) => d && { id: runs[i].id, ...d })
      return json(res, crewStats(full.filter(Boolean)))
    }
    if (get && parts[0] === "x" && (parts.length === 2 || parts.length === 3)) {
      const key = decode(parts[1])
      const id = parts[2] === undefined ? null : decode(parts[2])
      const fn = Object.hasOwn(adapter.extras ?? {}, key) ? adapter.extras[key] : null
      if (!fn || (parts.length === 3 && !isExtrasId(id))) return notFound(res)
      return sendExtra(res, await fn(id, url.searchParams))
    }
    if (req.method === "POST" && parts[0] === "run" && parts[2] === "action" && parts.length === 4) {
      const id = decode(parts[1]), name = decode(parts[3])
      const fn = Object.hasOwn(adapter.actions ?? {}, name) ? adapter.actions[name] : null
      if (!fn || !isRunId(id)) return notFound(res)
      const raw = await readBody(req)
      const body = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}
      return json(res, (await fn(id, body)) ?? {})
    }
  } catch (e) {
    if (Number.isInteger(e?.status)) return json(res, { error: e.message }, e.status)
    throw e
  }
  return notFound(res)
}

const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"]

/**
 * `input` is one v1 adapter, one source, or an array of either. Every entry becomes a source;
 * the v1 routes (/api/runs, /api/run/..., /api/crew, /api/x/...) stay as aliases for the first adapter.
 */
export function createServer(input, { port = 4319, distDir = DEFAULT_DIST } = {}) {
  const entries = Array.isArray(input) ? input : [input]
  const sources = entries.map((e) => (typeof e.listItems === "function" ? e : fromAdapter(e)))
  const registry = createRegistry(sources)
  const adapter = entries.find((e) => typeof e.listRuns === "function") ?? null
  const ctx = { adapter, registry }
  if (!existsSync(join(distDir, "index.html"))) {
    console.error(`mission control: no built page at ${join(distDir, "index.html")} — run npm run build`)
  }
  // Filled once the actual port is known (port 0 picks one).
  let hosts = new Set(), origins = new Set()
  const handler = async (req, res) => {
    // DNS rebinding: a foreign page can reach 127.0.0.1 under its own hostname. Only loopback
    // Host names on our own port are served, so the Origin check below cannot be fooled.
    if (!hosts.has(req.headers.host)) return json(res, { error: "host not allowed" }, 403)
    try {
      const url = new URL(req.url, "http://localhost")
      if (req.method === "POST") {
        // A cross-site form can only send simple content types; requiring JSON stops it.
        const type = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase()
        if (type !== "application/json") return json(res, { error: "content-type must be application/json" }, 415)
        const origin = req.headers.origin
        if (origin !== undefined && !origins.has(origin)) return json(res, { error: "cross-origin request refused" }, 403)
        return await api(ctx, req, res, url)
      }
      if (req.method !== "GET" && req.method !== "HEAD") return json(res, { error: "not found" }, 404)
      if (url.pathname === "/api/capabilities") {
        return json(res, {
          adapter: adapter?.name ?? null,
          extras: Object.keys(adapter?.extras ?? {}),
          actions: Object.keys(adapter?.actions ?? {}),
          source: adapter?.describe?.().source ?? null,
        })
      }
      if (url.pathname.startsWith("/api/")) return await api(ctx, req, res, url)
      return await serveStatic(res, distDir, url.pathname)
    } catch (e) {
      json(res, { error: String(e?.message ?? e) }, 500)
    }
  }

  // Loopback only, on both IPv4 and IPv6: browsers often resolve "localhost" to ::1 first.
  return new Promise((resolveStart, reject) => {
    const v4 = createHttpServer(handler)
    v4.once("error", (e) => {
      console.error(
        `mission control: cannot listen on ${port}: ${e.code === "EADDRINUSE" ? "the port is in use (another dashboard?); pass --port" : e.message}`,
      )
      reject(e)
    })
    v4.listen(port, "127.0.0.1", () => {
      const actual = v4.address().port
      hosts = new Set(LOOPBACK.map((h) => `${h}:${actual}`))
      origins = new Set(LOOPBACK.map((h) => `http://${h}:${actual}`))
      const v6 = createHttpServer(handler)
      // Not fatal: 127.0.0.1 is up; browsers that try ::1 first fall back to it.
      v6.on("error", (e) => console.error(`mission control: ::1 listener failed: ${e.code ?? e.message}`))
      v6.listen(actual, "::1")
      console.log(`mission control on http://localhost:${actual}`)
      resolveStart({
        port: actual,
        close: () =>
          new Promise((done) => {
            v6.close(() => v4.close(() => done()))
            v4.closeAllConnections?.()
            v6.closeAllConnections?.()
          }),
      })
    })
  })
}
