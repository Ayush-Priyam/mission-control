import { createServer as createHttpServer } from "node:http"
import { readFile, realpath } from "node:fs/promises"
import { dirname, extname, join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { isRunId, isSessionName } from "./names.mjs"
import { crewStats } from "./crew.mjs"

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

const decode = (s) => { try { return decodeURIComponent(s) } catch { return null } }

async function api(adapter, req, res, url) {
  const parts = url.pathname.split("/").slice(2) // after "/api"
  const get = req.method === "GET" || req.method === "HEAD"
  try {
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
      if (!fn || (parts.length === 3 && !isRunId(id))) return notFound(res)
      const r = await fn(id, url.searchParams)
      const status = r.status ?? 200
      if (r.type && !/json/i.test(r.type)) {
        res.writeHead(status, { "content-type": r.type, "cache-control": "no-store" })
        return res.end(r.body)
      }
      return json(res, r.body, status)
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

export function createServer(adapter, { port = 4319, distDir = DEFAULT_DIST } = {}) {
  const handler = async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost")
      if (req.method === "POST") return await api(adapter, req, res, url)
      if (req.method !== "GET" && req.method !== "HEAD") return json(res, { error: "not found" }, 404)
      if (url.pathname === "/api/capabilities") {
        return json(res, {
          adapter: adapter.name,
          extras: Object.keys(adapter.extras ?? {}),
          actions: Object.keys(adapter.actions ?? {}),
          source: adapter.describe?.().source ?? null,
        })
      }
      if (url.pathname.startsWith("/api/")) return await api(adapter, req, res, url)
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
      const v6 = createHttpServer(handler)
      v6.on("error", () => {})
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
