import { test } from "node:test"
import assert from "node:assert/strict"
import { startNotifier } from "../src/notify.mjs"

test("notifier: done fires once when an open session goes working to idle, not when it closes or waits", async () => {
  const it = (id, status, extra = {}) => ({ source: "cc", id, title: id, status, open: true, ...extra })
  let items = [it("a", "working"), it("b", "working"), it("c", "working"), it("d", "idle"), it("e", "working")]
  const sent = []
  const registry = { list: async () => items, overview: async () => ({ needsYou: [] }) }
  const n = startNotifier({ registry, enabled: (k) => k === "done", notify: (m) => sent.push(`${m.title} ${m.subtitle}`), everyMs: 1e9 })
  await n.ready
  items = [it("a", "idle"), it("b", "idle", { open: false }), it("c", "waiting"), it("d", "idle"), it("e", "idle", { parkedInto: "x" })]
  await n.pass()
  await n.pass()
  n.stop()
  assert.deepEqual(sent, ["Done a"])
})

test("notifier: only newly waiting items notify, never on the first pass, and not while disabled", async () => {
  let waiting = [{ source: "cc", id: "a", title: "old prompt", detail: "x" }]
  let on = true
  const sent = []
  const registry = { list: async () => [], overview: async () => ({ needsYou: waiting }) }
  const n = startNotifier({ registry, enabled: () => on, notify: (m) => sent.push(`${m.subtitle} ${m.url}`), link: (x) => `#/item/${x.id}`, everyMs: 1e9 })
  await n.ready
  waiting = [...waiting, { source: "cc", id: "b", title: "day0paywall", detail: "permission for Bash" }]
  await n.pass()
  on = false
  waiting = [...waiting, { source: "cc", id: "c", title: "muted", detail: "" }]
  await n.pass()
  n.stop()
  assert.deepEqual(sent, ["day0paywall #/item/b"])
})

test("server: a notification goes to pages that asked (?notify=1) over /api/events, else to the fallback", async () => {
  const { createServer } = await import("../src/server.mjs")
  const { mkdtempSync, writeFileSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const dist = mkdtempSync(join(tmpdir(), "mc-dist-"))
  writeFileSync(join(dist, "index.html"), "ok")
  const fallback = []
  const src = { name: "cc", harness: "claude-code", listItems: async () => [], getItem: async () => null, getCalls: async () => [], getSession: async () => null }
  const srv = await createServer(src, { port: 0, distDir: dist, notifier: (m) => fallback.push(m.title) })
  const base = `http://127.0.0.1:${srv.port}`
  const test = async () => (await (await fetch(`${base}/api/settings/test`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json()).via
  try {
    assert.equal(await test(), "macOS")
    assert.deepEqual(fallback, ["Test"])
    const plain = await fetch(`${base}/api/events`) // a page that did not ask: does not count
    const asked = await fetch(`${base}/api/events?notify=1`)
    const reader = asked.body.getReader()
    await reader.read() // the opening heartbeat
    assert.equal(await test(), "page (1)")
    let text = ""
    while (!text.includes("event: notify")) text += new TextDecoder().decode((await reader.read()).value)
    assert.match(text, /event: notify\ndata: \{"title":"Test"/)
    assert.deepEqual(fallback, ["Test"])
    await reader.cancel()
    await plain.body.cancel()
  } finally { await srv.close() }
})
