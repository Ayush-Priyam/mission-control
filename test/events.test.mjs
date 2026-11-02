import { test } from "node:test"
import assert from "node:assert/strict"
import { appendFileSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs"
import { request } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServer } from "../src/server.mjs"
import { createChangeFeed } from "../src/events.mjs"
import create from "../src/sources/claude-code/index.mjs"

const tmp = () => mkdtempSync(join(tmpdir(), "mc-events-"))
const dist = () => { const d = tmp(); writeFileSync(join(d, "index.html"), "<!doctype html>"); return d }

/** Open /api/events; resolves with { status, events: string[], waitFor(name), close }. */
function listen(port, headers = {}) {
  return new Promise((resolve, reject) => {
    const events = []
    const waiters = []
    const req = request({ host: "127.0.0.1", port, path: "/api/events", headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      res.setEncoding("utf8")
      let buf = ""
      res.on("data", (c) => {
        buf += c
        let i
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2)
          const m = /^event: (\w+)/m.exec(block)
          if (m) { events.push(m[1]); for (const w of [...waiters]) if (w.name === m[1]) { waiters.splice(waiters.indexOf(w), 1); w.done() } }
        }
      })
      resolve({
        status: res.statusCode,
        type: res.headers["content-type"],
        events,
        waitFor: (name, ms = 3000) => new Promise((ok, no) => {
          if (events.includes(name)) return ok()
          const t = setTimeout(() => no(new Error(`no ${name} event in ${ms} ms; got ${events}`)), ms)
          waiters.push({ name, done: () => { clearTimeout(t); ok() } })
        }),
        close: () => req.destroy(),
      })
    })
    req.on("error", reject)
    req.end()
  })
}

test("/api/events: an SSE stream that emits 'changed' within moments of a hook line landing", async () => {
  const root = tmp(), hooksDir = tmp()
  mkdirSync(join(root, "-work-shop"))
  const now = Date.now()
  const log = join(root, "-work-shop", "s1.jsonl")
  writeFileSync(log, JSON.stringify({ type: "user", cwd: "/work/shop", timestamp: new Date(now).toISOString(), message: { role: "user", content: "hi" } }) + "\n")
  const srv = await createServer([create({ root, hooksDir })], { port: 0, distDir: dist(), eventsPollMs: 100 })
  const es = await listen(srv.port)
  try {
    assert.equal(es.status, 200)
    assert.match(es.type, /^text\/event-stream/)
    await es.waitFor("heartbeat") // sent on connect
    await new Promise((r) => setTimeout(r, 150)) // the feed has started watching
    appendFileSync(join(hooksDir, "s1.jsonl"), JSON.stringify({ event: "PermissionRequest", sessionId: "s1", ts: new Date().toISOString(), tool: "Bash" }) + "\n")
    await es.waitFor("changed")
  } finally { es.close(); await srv.close() }
})

test("/api/events: a live session file that grows emits 'changed' (polled stat)", async () => {
  const root = tmp()
  mkdirSync(join(root, "-work-shop"))
  const log = join(root, "-work-shop", "s1.jsonl")
  writeFileSync(log, JSON.stringify({ type: "user", cwd: "/work/shop", timestamp: new Date().toISOString(), message: { role: "user", content: "hi" } }) + "\n")
  const src = create({ root })
  await src.listItems() // the listing records which files are live
  const srv = await createServer([src], { port: 0, distDir: dist(), eventsPollMs: 50 })
  const es = await listen(srv.port)
  try {
    await new Promise((r) => setTimeout(r, 120))
    appendFileSync(log, JSON.stringify({ type: "assistant", timestamp: new Date().toISOString(), message: { role: "assistant", content: [{ type: "text", text: "x" }] } }) + "\n")
    await es.waitFor("changed")
  } finally { es.close(); await srv.close() }
})

test("/api/events: same Host and Origin checks as every route", async () => {
  const srv = await createServer([], { port: 0, distDir: dist() })
  try {
    const foreign = await listen(srv.port, { origin: "http://evil.example" })
    assert.equal(foreign.status, 403)
    foreign.close()
    const rebind = await listen(srv.port, { host: `evil.example:${srv.port}` })
    assert.equal(rebind.status, 403)
    rebind.close()
    const own = await listen(srv.port, { origin: `http://localhost:${srv.port}` })
    assert.equal(own.status, 200)
    own.close()
  } finally { await srv.close() }
})

test("change feed: debounced to one 'changed' per burst, and idle once stopped", async () => {
  const dir = tmp()
  let n = 0
  const feed = createChangeFeed({ targets: () => ({ dirs: [dir], files: [] }), debounceMs: 100, pollMs: 50, onChange: () => n++ })
  feed.start()
  await new Promise((r) => setTimeout(r, 60))
  for (let i = 0; i < 5; i++) appendFileSync(join(dir, "a.jsonl"), "{}\n")
  await new Promise((r) => setTimeout(r, 300))
  assert.equal(n, 1)
  feed.stop()
  appendFileSync(join(dir, "a.jsonl"), "{}\n")
  await new Promise((r) => setTimeout(r, 200))
  assert.equal(n, 1)
  assert.equal(feed.running(), false)
})
