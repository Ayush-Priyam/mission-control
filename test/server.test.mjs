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
