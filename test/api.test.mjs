import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { createServer as net } from "node:net"
import { spawn } from "node:child_process"
import { get as httpGet } from "node:http"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createServer } from "../src/server.mjs"
import createNative from "../src/adapters/native.mjs"
import { loadAdapter } from "../src/adapters/load.mjs"

const root = resolve(fileURLToPath(import.meta.url), "..", "..")
const runsDir = join(root, "test/fixtures/runs")

async function withServer(adapter, fn) {
  const distDir = mkdtempSync(join(tmpdir(), "mc-dist-"))
  writeFileSync(join(distDir, "index.html"), "<h1>ok</h1>")
  const srv = await createServer(adapter, { port: 0, distDir })
  try { await fn(`http://127.0.0.1:${srv.port}`) } finally { await srv.close() }
}
const JSON_TYPE = { "content-type": "application/json" }
const native = () => createNative({ runsDir, now: () => Date.parse("2026-11-01T12:00:00Z") })

test("runs, run detail, missing run", async () => {
  await withServer(native(), async (base) => {
    const runs = await (await fetch(`${base}/api/runs`)).json()
    assert.equal(runs.length, 3)
    const run = await (await fetch(`${base}/api/run/20261101-0900-done`)).json()
    assert.ok(run.events.length > 0)
    const res = await fetch(`${base}/api/run/nope`)
    assert.equal(res.status, 404)
    assert.deepEqual(await res.json(), { error: "no such run" })
  })
})

test("session route allows names, rejects tricks", async () => {
  await withServer(native(), async (base) => {
    const ok = await fetch(`${base}/api/run/20261101-0900-done/session/backend-1.md`)
    assert.equal(ok.status, 200)
    assert.ok((await ok.json()).text)
    for (const n of ["%2e%2e%2fstate.json", "a.txt"]) {
      const r = await fetch(`${base}/api/run/20261101-0900-done/session/${n}`)
      assert.equal(r.status, 400, n)
      assert.deepEqual(await r.json(), { error: "not allowed" })
    }
    assert.equal((await fetch(`${base}/api/run/20261101-0900-done/session/none.md`)).status, 404)
  })
})

test("extras: 404 for native, stub body, raw non-JSON type", async () => {
  await withServer(native(), async (base) => {
    assert.equal((await fetch(`${base}/api/x/tasks/20261101-0900-done`)).status, 404)
  })
  const stub = {
    ...native(),
    name: "stub",
    extras: {
      tasks: async (id, q) => ({ body: { id, q: q.get("a") } }),
      raw: async () => ({ type: "image/png", body: Buffer.from([1, 2, 3]) }),
    },
  }
  await withServer(stub, async (base) => {
    assert.deepEqual(await (await fetch(`${base}/api/x/tasks/20261101-0900-done?a=1`)).json(), { id: "20261101-0900-done", q: "1" })
    assert.deepEqual(await (await fetch(`${base}/api/x/tasks`)).json(), { id: null, q: null })
    const img = await fetch(`${base}/api/x/raw`)
    assert.equal(img.headers.get("content-type"), "image/png")
    assert.deepEqual([...new Uint8Array(await img.arrayBuffer())], [1, 2, 3])
  })
})

test("extras id: dotted ids accepted, traversal rejected", async () => {
  const stub = { ...native(), name: "stub", extras: { project: async (id) => ({ body: { id } }) } }
  await withServer(stub, async (base) => {
    assert.deepEqual(await (await fetch(`${base}/api/x/project/my.app`)).json(), { id: "my.app" })
    for (const bad of ["..", "%2e%2e", ".", "a%2Fb", "a%5Cb"]) {
      const r = await fetch(`${base}/api/x/project/${bad}`)
      assert.equal(r.status, 404, bad)
    }
  })
})

test("actions: undeclared 404, thrown status passes through, body delivered", async () => {
  const stub = {
    ...native(),
    actions: {
      sign: async () => { throw { status: 409, message: "busy" } },
      say: async (id, body) => ({ id, got: body }),
    },
  }
  const post = (base, name, body) =>
    fetch(`${base}/api/run/20261101-0900-done/action/${name}`, { method: "POST", headers: JSON_TYPE, body: JSON.stringify(body) })
  await withServer(stub, async (base) => {
    assert.equal((await post(base, "nope", {})).status, 404)
    const r = await post(base, "sign", {})
    assert.equal(r.status, 409)
    assert.deepEqual(await r.json(), { error: "busy" })
    assert.deepEqual(await (await post(base, "say", { t: "hi" })).json(), { id: "20261101-0900-done", got: { t: "hi" } })
    const big = await fetch(`${base}/api/run/20261101-0900-done/action/say`, { method: "POST", headers: JSON_TYPE, body: "x".repeat(70_000) })
    assert.equal(big.status, 413)
  })
})

test("crew: all runs, repo filter, fixtures grid", async () => {
  const ev = [{ type: "stage.start", stage: "backend" }, { type: "session", stage: "backend", cost: 1, tokens: { output_tokens: 5 } }]
  const stub = {
    name: "stub",
    listRuns: async () => [{ id: "a", repo: "/w/one" }, { id: "b", repo: "/w/two" }],
    getRun: async (id) => ({ state: {}, events: id === "a" ? ev : [], live: false }),
    getSession: async () => null,
  }
  await withServer(stub, async (base) => {
    const all = await (await fetch(`${base}/api/crew`)).json()
    assert.equal(all.crew.backend.sessions, 1)
    assert.deepEqual(Object.keys(all.grid), ["a", "b"])
    const two = await (await fetch(`${base}/api/crew?repo=two`)).json()
    assert.deepEqual(two.crew, {})
    assert.deepEqual(Object.keys(two.grid), ["b"])
  })
  await withServer(native(), async (base) => {
    const real = await (await fetch(`${base}/api/crew`)).json()
    assert.equal(real.crew.backend.sessions, 2)
    assert.equal(real.crew.backend.tokens, 2500)
    assert.equal(real.crew.backend.cost, 0.53)
    assert.deepEqual(real.crew.backend.models, ["claude-sonnet-4-5"])
    assert.equal(real.crew.backend.rounds, 2)
    assert.equal(real.crew.qa.raised, 1)
    assert.equal(real.crew.qa.stops, 1)
    assert.equal(real.bounces["qa>backend"], 1)
    const one = await (await fetch(`${base}/api/crew?repo=greeter`)).json()
    assert.deepEqual(Object.keys(one.grid), ["20261101-0900-done"])
    assert.equal(one.grid["20261101-0900-done"].build.status, "done")
  })
})

test("empty runs dir lists []", async () => {
  const empty = createNative({ runsDir: mkdtempSync(join(tmpdir(), "mc-empty-")) })
  await withServer(empty, async (base) => {
    assert.deepEqual(await (await fetch(`${base}/api/runs`)).json(), [])
  })
  await withServer(createNative({ runsDir: join(tmpdir(), "mc-does-not-exist") }), async (base) => {
    assert.deepEqual(await (await fetch(`${base}/api/runs`)).json(), [])
  })
})

test("static path tricks never leave dist", async () => {
  await withServer(native(), async (base) => {
    for (const p of ["/..%2f..%2fpackage.json", "/%2e%2e/%2e%2e/package.json", "//etc/passwd", "/%2fetc%2fpasswd", "/package.json"]) {
      const r = await fetch(base + p)
      assert.ok([400, 404].includes(r.status), `${p} -> ${r.status}`)
      assert.doesNotMatch(await r.text(), /"name": "mission-control"/)
    }
  })
})

test("raw encoded dot-dot requests never return package.json", async () => {
  await withServer(native(), async (base) => {
    const { port } = new URL(base)
    for (const path of ["/..%2f..%2fpackage.json", "/%2e%2e/%2e%2e/package.json"]) {
      const { status, text } = await new Promise((done, fail) => {
        httpGet({ host: "127.0.0.1", port, path }, (res) => {
          let t = ""
          res.on("data", (d) => { t += d })
          res.on("end", () => done({ status: res.statusCode, text: t }))
        }).on("error", fail)
      })
      assert.notEqual(status, 200, path)
      assert.doesNotMatch(text, /"name": "mission-control"/, path)
    }
  })
})

test("actions: non-object bodies become {}, undefined result becomes {}", async () => {
  const stub = { ...native(), actions: { say: async (id, body) => (Array.isArray(body) || body === null ? { bad: true } : body.keep ? undefined : { body }) } }
  const post = (base, text) => fetch(`${base}/api/run/20261101-0900-done/action/say`, { method: "POST", headers: JSON_TYPE, body: text })
  await withServer(stub, async (base) => {
    for (const t of ["null", "[1,2]", "7"]) assert.deepEqual(await (await post(base, t)).json(), { body: {} }, t)
    assert.deepEqual(await (await post(base, '{"keep":1}')).json(), {})
  })
})

// CLI children get a temp HOME: they must never read the owner's ~/.mission-control or ~/.claude.
const tempHome = () => ({ ...process.env, HOME: mkdtempSync(join(tmpdir(), "mc-home-")) })

const run = (args) =>
  new Promise((done) => {
    const p = spawn("node", [join(root, "bin/mission-control.mjs"), "--no-claude", ...args], { cwd: root, env: tempHome() })
    let out = "", err = ""
    p.stdout.on("data", (d) => { out += d })
    p.stderr.on("data", (d) => { err += d })
    p.on("exit", (code) => done({ code, out, err }))
  })

test("port in use", async () => {
  const blocker = net()
  await new Promise((r) => blocker.listen(0, "127.0.0.1", r))
  const p = blocker.address().port
  try {
    const r = await run(["--runs", "test/fixtures/runs", "--port", String(p), "--no-open"])
    assert.equal(r.code, 1)
    assert.equal(r.err.trim(), `mission control: cannot listen on ${p}: the port is in use (another dashboard?); pass --port`)
  } finally { blocker.close() }
})

test("prints the startup line", async () => {
  const probe = net()
  await new Promise((r) => probe.listen(0, "127.0.0.1", r))
  const p = probe.address().port
  await new Promise((r) => probe.close(r))
  const child = spawn("node", [join(root, "bin/mission-control.mjs"), "--runs", "test/fixtures/runs", "--port", String(p), "--no-open", "--no-claude"], { cwd: root, env: tempHome() })
  try {
    const first = await new Promise((res, rej) => {
      let buf = ""
      child.stdout.on("data", (d) => { buf += d; if (buf.includes("\n")) res(buf.split("\n")[0]) })
      child.on("exit", () => rej(new Error("exited")))
    })
    assert.equal(first, `mission control on http://localhost:${p}`)
  } finally { child.kill() }
})

test("--port must be an integer 0-65535", async () => {
  for (const v of ["abc", "-1", "70000", "1.5", ""]) {
    const r = await run(["--port", v, "--no-open"])
    assert.equal(r.code, 2, v)
    assert.equal(r.err.trim(), "mission control: --port needs a number")
  }
})

test("loadAdapter picks native for runs dirs and bare paths", async () => {
  assert.equal((await loadAdapter(["--runs", "test/fixtures/runs"], root)).name, "native")
  assert.equal((await loadAdapter([runsDir], root)).name, "native")
  assert.equal((await loadAdapter([], mkdtempSync(join(tmpdir(), "mc-cwd-")))).name, "native")
})

test("loadAdapter --adapter injects runsDir, createNative and opts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mc-ext-"))
  writeFileSync(join(dir, "ext.mjs"), "export default (o) => ({ name: 'ext', o, listRuns: async () => [], getRun: async () => null, getSession: async () => null })")
  const a = await loadAdapter(["--adapter", "ext.mjs", "--adapter-opt", "k=v=w", "--runs", "r"], dir)
  assert.equal(a.name, "ext")
  assert.equal(a.o.k, "v=w")
  assert.equal(a.o.runsDir, join(dir, "r"))
  assert.equal(a.o.createNative({ runsDir }).name, "native")
})

test("loadAdapter: bare path to test/fixtures/speckit selects the speckit adapter", async () => {
  assert.equal((await loadAdapter(["test/fixtures/speckit"], root)).name, "speckit")
})

test("loadAdapter --adapter without --runs defaults runsDir to cwd/runs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mc-ext2-"))
  writeFileSync(join(dir, "ext.mjs"), "export default (o) => ({ name: 'ext', o })")
  assert.equal((await loadAdapter(["--adapter", "ext.mjs"], dir)).o.runsDir, join(dir, "runs"))
})

test("M3: the port comes from --port or MISSION_CONTROL_PORT; PORT is ignored", async () => {
  const probe = net()
  await new Promise((r) => probe.listen(0, "127.0.0.1", r))
  const p = probe.address().port
  await new Promise((r) => probe.close(r))
  const child = spawn("node", [join(root, "bin/mission-control.mjs"), "--runs", "test/fixtures/runs", "--no-open", "--no-claude"], {
    cwd: root, env: { ...tempHome(), PORT: "not-a-port", MISSION_CONTROL_PORT: String(p) },
  })
  try {
    const first = await new Promise((res, rej) => {
      let buf = ""
      child.stdout.on("data", (d) => { buf += d; if (buf.includes("\n")) res(buf.split("\n")[0]) })
      child.on("exit", (code) => rej(new Error(`exited ${code}`)))
    })
    assert.equal(first, `mission control on http://localhost:${p}`)
  } finally { child.kill() }
})

test("minor 2: v2 item routes of an adapter-backed source take run ids only; extras keep dotted keys", async () => {
  const seen = []
  const adapter = {
    name: "ex",
    listRuns: async () => [],
    getRun: async (id) => { seen.push(["getRun", id]); return null },
    getSession: async (id) => { seen.push(["getSession", id]); return null },
    extras: { info: async (id) => ({ body: { id } }) },
    actions: { say: async (id) => { seen.push(["say", id]); return { ok: true } } },
  }
  await withServer(adapter, async (base) => {
    for (const path of ["/api/item/ex/my.run", "/api/item/ex/my.run/calls", "/api/item/ex/my.run/session/a.md"]) {
      assert.equal((await fetch(base + path)).status, 400, path)
    }
    assert.equal((await fetch(`${base}/api/item/ex/my.run/action/say`, { method: "POST", headers: JSON_TYPE, body: "{}" })).status, 400)
    assert.deepEqual(seen, [], "the adapter never sees a dotted id")
    assert.deepEqual(await (await fetch(`${base}/api/item/ex/my.app/x/info`)).json(), { id: "my.app" })
    assert.equal((await fetch(`${base}/api/item/ex/r-1/action/say`, { method: "POST", headers: JSON_TYPE, body: "{}" })).status, 200)
  })
})
