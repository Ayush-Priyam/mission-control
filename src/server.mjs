import { createServer as createHttpServer } from "node:http"
import { readFile, realpath } from "node:fs/promises"
import { dirname, extname, join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

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

export function createServer(adapter, { port = 4319, distDir = DEFAULT_DIST } = {}) {
  const handler = async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost")
      if (req.method !== "GET" && req.method !== "HEAD") return json(res, { error: "not found" }, 404)
      if (url.pathname === "/api/capabilities") {
        return json(res, {
          adapter: adapter.name,
          extras: Object.keys(adapter.extras ?? {}),
          actions: Object.keys(adapter.actions ?? {}),
        })
      }
      if (url.pathname.startsWith("/api/")) return json(res, { error: "not found" }, 404)
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
