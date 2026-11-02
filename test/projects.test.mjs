import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildTree, createGit } from "../src/projects.mjs"
import create from "../src/sources/claude-code/index.mjs"
import { createServer } from "../src/server.mjs"

const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), "mc-proj-")))
const git = (cwd, ...args) => execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], { cwd, stdio: "pipe" })
const item = (id, cwd, extra = {}) => ({ source: "claude-code", id, kind: "session", title: id, cwd, live: false, status: "idle", waiting: false, updatedAt: "2026-11-01T00:00:00.000Z", ...extra })

function repoWithWorktree() {
  const base = tmp()
  const main = join(base, "shop")
  mkdirSync(main)
  git(main, "init", "-q", "-b", "main")
  writeFileSync(join(main, "a.txt"), "a")
  git(main, "add", ".")
  git(main, "commit", "-q", "-m", "init")
  const linked = join(base, "shop-feat")
  git(main, "worktree", "add", "-q", "-b", "feat/cart", linked)
  const empty = join(base, "shop-empty")
  git(main, "worktree", "add", "-q", "-b", "idle-branch", empty)
  return { base, main, linked: realpathSync(linked), empty: realpathSync(empty) }
}

test("items in the main checkout and a linked worktree group under one project", async () => {
  const r = repoWithWorktree()
  writeFileSync(join(r.main, "dirty.txt"), "x")
  const sub = join(r.main, "sub")
  mkdirSync(sub)
  const tree = await buildTree([item("a", r.main, { live: true }), item("b", r.linked, { branch: "feat/cart", waiting: true }), item("c", sub)], { git: createGit() })
  assert.equal(tree.length, 1)
  const p = tree[0]
  assert.equal(p.name, "shop")
  assert.equal(p.path, r.main)
  assert.equal(p.worktrees.length, 3) // main, linked, and the empty one added from `git worktree list`
  const by = Object.fromEntries(p.worktrees.map((w) => [w.path, w]))
  assert.deepEqual(by[r.main].items.map((i) => i.id).sort(), ["a", "c"])
  assert.equal(by[r.main].branch, "main")
  assert.equal(by[r.main].dirty, 1)
  assert.equal(by[r.main].live, true)
  assert.equal(by[r.linked].branch, "feat/cart")
  assert.equal(by[r.linked].waiting, true)
  assert.equal(by[r.linked].dirty, 0)
  assert.deepEqual([by[r.empty].items.length, by[r.empty].branch], [0, "idle-branch"])
  assert.equal(by[r.main].ahead, undefined) // no upstream
})

test("ahead and behind come from the upstream when there is one", async () => {
  const r = repoWithWorktree()
  const remote = join(r.base, "remote.git")
  git(r.base, "init", "-q", "--bare", remote)
  git(r.main, "remote", "add", "origin", remote)
  git(r.main, "push", "-q", "-u", "origin", "main")
  writeFileSync(join(r.main, "b.txt"), "b")
  git(r.main, "add", ".")
  git(r.main, "commit", "-q", "-m", "second")
  const [p] = await buildTree([item("a", r.main)], { git: createGit() })
  const w = p.worktrees.find((x) => x.path === r.main)
  assert.deepEqual([w.ahead, w.behind], [1, 0])
})

test("a missing cwd, a plain directory and no cwd fall back without error", async () => {
  const plain = tmp()
  const tree = await buildTree([item("gone", "/nowhere/at/all", { branch: "x" }), item("plain", plain), item("none", undefined)], { git: createGit() })
  assert.equal(tree.length, 3)
  const gone = tree.find((p) => p.path === "/nowhere/at/all")
  assert.equal(gone.worktrees[0].branch, "x")
  assert.equal(gone.worktrees[0].dirty, undefined)
  assert.equal(tree.find((p) => p.path === plain).worktrees[0].items[0].id, "plain")
  assert.equal(tree.find((p) => p.name === "(no project)").worktrees[0].items[0].id, "none")
})

test("a throwing git is swallowed", async () => {
  const boom = { resolve: () => { throw new Error("x") }, worktrees: () => { throw new Error("x") }, status: () => { throw new Error("x") } }
  const tree = await buildTree([item("a", "/some/dir")], { git: boom })
  assert.equal(tree[0].worktrees[0].items.length, 1)
})

test("git lookups are cached per cwd (resolve for good, status within the ttl)", async () => {
  const r = repoWithWorktree()
  let t = 0
  const g = createGit({ ttl: 30_000, now: () => t })
  const first = await g.resolve(r.main)
  assert.equal(await g.resolve(r.main), first) // same promise result
  writeFileSync(join(r.main, "n.txt"), "n")
  const s1 = await g.status(r.main)
  writeFileSync(join(r.main, "m.txt"), "m")
  assert.equal((await g.status(r.main)).dirty, s1.dirty) // cached
  t = 31_000
  assert.equal((await g.status(r.main)).dirty, s1.dirty + 1) // expired
})

test("2,000 synthetic items build under 500 ms with a stub git", async () => {
  const calls = { resolve: 0 }
  const stub = {
    resolve: async (cwd) => { calls.resolve++; return { commonDir: `${cwd}/.git`, toplevel: cwd } },
    worktrees: async (c) => [{ path: c.replace(/\/\.git$/, ""), branch: "main" }],
    status: async () => ({ dirty: 2, ahead: 1, behind: 0 }),
  }
  const items = Array.from({ length: 2000 }, (_, i) => item(`s${i}`, `/work/p${i % 150}`, { updatedAt: new Date(1e12 + i * 1000).toISOString() }))
  const t0 = performance.now()
  const tree = await buildTree(items, { git: stub })
  const ms = performance.now() - t0
  assert.equal(tree.length, 150)
  assert.equal(tree.reduce((n, p) => n + p.worktrees.reduce((m, w) => m + w.items.length, 0), 0), 2000)
  assert.ok(ms < 500, `took ${ms} ms`)
})

test("claude-code: a first line over 64 KB still yields a cwd; slug decoding is the last resort", async () => {
  const root = tmp()
  const proj = join(tmp(), "my-app") // a real directory with a dash in its name
  mkdirSync(proj)
  const slugOf = (p) => p.replace(/[/.]/g, "-")
  const big = JSON.stringify({ type: "user", cwd: proj, timestamp: "2026-11-01T00:00:00.000Z", message: { content: "x".repeat(200_000) } })
  const small = JSON.stringify({ type: "user", cwd: proj, message: { content: "hi" } })
  const nocwd = JSON.stringify({ type: "user", message: { content: "x".repeat(200_000) } })
  const put = (slug, id, text) => { mkdirSync(join(root, slug), { recursive: true }); writeFileSync(join(root, slug, `${id}.jsonl`), text + "\n") }
  put("-elsewhere", "huge", big)
  put("-elsewhere", "small", small)
  put(slugOf(proj), "decoded", nocwd) // no cwd anywhere: the slug names a real directory
  put("-no-such-dir-anywhere", "lost", nocwd)
  const items = await create({ root }).listItems()
  const by = Object.fromEntries(items.map((i) => [i.id, i.cwd]))
  assert.equal(by.huge, proj)
  assert.equal(by.small, proj)
  assert.equal(by.decoded, proj)
  assert.ok(!by.lost)
})

test("server: /api/projects from cached claude-code summaries, 2,000 sessions warm under 500 ms", async () => {
  const root = tmp()
  const cwds = Array.from({ length: 40 }, (_, i) => `/work/proj${i}`)
  for (let i = 0; i < 2000; i++) {
    const slug = `-work-proj${i % 40}`
    mkdirSync(join(root, slug), { recursive: true })
    writeFileSync(join(root, slug, `s${i}.jsonl`), JSON.stringify({ type: "user", cwd: cwds[i % 40], gitBranch: "main", timestamp: "2026-11-01T00:00:00.000Z", message: { content: `task ${i}` } }) + "\n")
  }
  const stub = { resolve: async () => null, worktrees: async () => [], status: async () => null }
  const dist = tmp()
  writeFileSync(join(dist, "index.html"), "<!doctype html>")
  const srv = await createServer(create({ root }), { port: 0, distDir: dist, git: stub })
  const get = (p) => fetch(`http://127.0.0.1:${srv.port}${p}`)
  try {
    assert.equal((await get("/api/projects")).status, 200) // cold
    const t0 = performance.now()
    const res = await get("/api/projects")
    const tree = await res.json()
    const ms = performance.now() - t0
    assert.equal(tree.length, 40)
    assert.equal(tree.reduce((n, p) => n + p.worktrees[0].items.length, 0), 2000)
    assert.ok(ms < 500, `took ${ms} ms`)
    const one = await get(`/api/project/${encodeURIComponent(tree[0].key)}`)
    assert.equal((await one.json()).key, tree[0].key)
    assert.equal((await get("/api/project/nope-0")).status, 404)
    assert.equal((await get("/api/project/..%2Fx")).status, 400)
  } finally { await srv.close() }
})
