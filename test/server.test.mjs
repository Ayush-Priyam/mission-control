import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServer } from "../src/server.mjs"

const adapter = { name: "stub", listRuns: async () => [], getRun: async () => null, getSession: async () => null }

async function withServer(fn) {
  const distDir = mkdtempSync(join(tmpdir(), "mc-dist-"))
  writeFileSync(join(distDir, "index.html"), "<h1>ok</h1>")
  const srv = await createServer(adapter, { port: 0, distDir })
  try {
    await fn(`http://127.0.0.1:${srv.port}`)
  } finally {
    await srv.close()
  }
}

test("serves index and capabilities on loopback", async () => {
  await withServer(async (base) => {
    assert.match(await (await fetch(`${base}/`)).text(), /ok/)
    const res = await fetch(`${base}/api/capabilities`)
    assert.deepEqual(await res.json(), { adapter: "stub", extras: [], actions: [], source: null })
  })
})

test("unknown route is 404 json", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/nope`)
    assert.equal(res.status, 404)
    assert.deepEqual(await res.json(), { error: "not found" })
  })
})

test("capabilities exposes the adapter source from describe()", async () => {
  const distDir = mkdtempSync(join(tmpdir(), "mc-dist-"))
  const srv = await createServer({ ...adapter, describe: () => ({ source: "/some/runs" }) }, { port: 0, distDir })
  try {
    const caps = await (await fetch(`http://127.0.0.1:${srv.port}/api/capabilities`)).json()
    assert.equal(caps.source, "/some/runs")
  } finally {
    await srv.close()
  }
})

// Raw request with chosen headers (fetch forbids setting Host).
import { request } from "node:http"
function raw(port, { method = "GET", path = "/api/runs", headers = {}, body } = {}) {
  return new Promise((done, fail) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers, setHost: !("host" in headers) }, (res) => {
      let text = ""
      res.on("data", (c) => (text += c))
      res.on("end", () => done({ status: res.statusCode, headers: res.headers, text }))
    })
    req.on("error", fail)
    req.end(body)
  })
}
async function withPort(a, fn) {
  const distDir = mkdtempSync(join(tmpdir(), "mc-dist-"))
  writeFileSync(join(distDir, "index.html"), "<h1>ok</h1>")
  const srv = await createServer(a, { port: 0, distDir })
  try { await fn(srv.port) } finally { await srv.close() }
}
const acting = { ...adapter, actions: { say: async (id, body) => ({ id, body }) } }

test("C1: a request whose Host is not loopback on our port is refused 403", async () => {
  await withPort(acting, async (port) => {
    for (const host of ["evil.example", `evil.example:${port}`, `localhost:${port + 1}`, "localhost", `127.0.0.2:${port}`]) {
      const r = await raw(port, { headers: { host } })
      assert.equal(r.status, 403, host)
      assert.deepEqual(JSON.parse(r.text), { error: "host not allowed" })
    }
    for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]) {
      assert.equal((await raw(port, { headers: { host } })).status, 200, host)
    }
    assert.equal((await raw(port, { path: "/", headers: { host: "evil.example" } })).status, 403)
  })
})

test("C1: POST needs application/json (415) and a same-port loopback Origin when one is sent (403)", async () => {
  await withPort(acting, async (port) => {
    const path = "/api/run/r1/action/say"
    const host = `localhost:${port}`
    const noType = await raw(port, { method: "POST", path, headers: { host }, body: "{}" })
    assert.equal(noType.status, 415)
    const form = await raw(port, { method: "POST", path, headers: { host, "content-type": "text/plain" }, body: "{}" })
    assert.equal(form.status, 415)
    for (const origin of ["http://evil.example", `http://localhost:${port + 1}`, "null", `https://localhost:${port}`]) {
      const r = await raw(port, { method: "POST", path, headers: { host, origin, "content-type": "application/json" }, body: "{}" })
      assert.equal(r.status, 403, origin)
      assert.deepEqual(JSON.parse(r.text), { error: "cross-origin request refused" })
    }
    for (const origin of [undefined, `http://localhost:${port}`, `http://127.0.0.1:${port}`, `http://[::1]:${port}`]) {
      const headers = { host, "content-type": "application/json; charset=utf-8", ...(origin ? { origin } : {}) }
      const ok = await raw(port, { method: "POST", path, headers, body: '{"t":1}' })
      assert.equal(ok.status, 200, String(origin))
      assert.deepEqual(JSON.parse(ok.text), { id: "r1", body: { t: 1 } })
    }
  })
})

test("M2: non-JSON extras responses carry nosniff", async () => {
  const a = { ...adapter, extras: { raw: async () => ({ type: "text/plain; charset=utf-8", body: "hi" }) } }
  await withPort(a, async (port) => {
    const r = await raw(port, { path: "/api/x/raw/r1" })
    assert.equal(r.status, 200)
    assert.equal(r.headers["x-content-type-options"], "nosniff")
  })
})

test("C2: a missing dist/index.html logs one stderr line and the API still serves", async () => {
  const distDir = mkdtempSync(join(tmpdir(), "mc-nodist-"))
  const errs = []
  const orig = console.error
  console.error = (...a) => errs.push(a.join(" "))
  let srv
  try { srv = await createServer(adapter, { port: 0, distDir }) } finally { console.error = orig }
  try {
    assert.deepEqual(errs, [`mission control: no built page at ${join(distDir, "index.html")} — run npm run build`])
    const r = await raw(srv.port, { path: "/api/runs" })
    assert.equal(r.status, 200)
  } finally { await srv.close() }
})

test("M4: a failed ::1 listener is logged, not fatal", async () => {
  const { createServer: net } = await import("node:net")
  const blocker = net()
  const ok = await new Promise((r) => { blocker.once("error", () => r(false)); blocker.listen(0, "::1", () => r(true)) })
  if (!ok) return // no IPv6 loopback here
  const port = blocker.address().port
  const errs = []
  const orig = console.error
  console.error = (...a) => errs.push(a.join(" "))
  const distDir = mkdtempSync(join(tmpdir(), "mc-dist-"))
  writeFileSync(join(distDir, "index.html"), "<h1>ok</h1>")
  let srv
  try {
    srv = await createServer(adapter, { port, distDir })
    await new Promise((r) => setTimeout(r, 50))
  } finally { console.error = orig; blocker.close() }
  try {
    assert.deepEqual(errs, ["mission control: ::1 listener failed: EADDRINUSE"])
    assert.equal((await raw(srv.port, { headers: { host: `localhost:${port}` } })).status, 200)
  } finally { await srv.close() }
})
