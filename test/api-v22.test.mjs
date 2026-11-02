import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { createServer } from "../src/server.mjs"
import create from "../src/sources/claude-code/index.mjs"

const claudeRoot = fileURLToPath(new URL("./fixtures/claude/projects", import.meta.url))
// git stub: no repos, so projects fall back to the cwd
export const noGit = { resolve: async () => null, worktrees: async () => null, status: async () => null }

export async function withServer(sources, opts, fn) {
  const distDir = mkdtempSync(join(tmpdir(), "mc-dist-"))
  writeFileSync(join(distDir, "index.html"), "<h1>ok</h1>")
  const srv = await createServer(sources, { port: 0, distDir, git: noGit, ...opts })
  try { await fn(`http://127.0.0.1:${srv.port}`) } finally { await srv.close() }
}

test("config route: an item's configured MCP servers and skills joined to its calls; project note lists unused servers", async () => {
  const home = mkdtempSync(join(tmpdir(), "mc-cfg-"))
  writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: { ctx: { env: { K: "sk-SECRET" } }, figma: {} } }))
  mkdirSync(join(home, ".claude", "skills", "brainstorming"), { recursive: true })
  writeFileSync(join(home, ".claude", "skills", "brainstorming", "SKILL.md"), "x")
  mkdirSync(join(home, ".claude", "skills", "tdd"), { recursive: true })
  writeFileSync(join(home, ".claude", "skills", "tdd", "SKILL.md"), "x")
  await withServer([create({ root: claudeRoot })], { claudeHome: home }, async (base) => {
    const r = await (await fetch(`${base}/api/item/claude-code/s1/config`)).json()
    assert.equal(r.harness, "claude-code")
    assert.deepEqual(r.servers.map((s) => [s.name, s.status]), [["ctx", "used"], ["figma", "unused"]])
    assert.deepEqual(r.skills.map((s) => [s.name, s.status]), [["brainstorming", "used"], ["tdd", "unused"]])
    assert.ok(!JSON.stringify(r).includes("SECRET"))
    const items = await (await fetch(`${base}/api/items?all=1`)).json()
    const key = items[0].project.key
    const p = await (await fetch(`${base}/api/project/${key}/config`)).json()
    assert.equal(p.sessions, 2)
    assert.deepEqual(p.unusedServers, [{ name: "figma", scope: "user" }])
    assert.equal((await fetch(`${base}/api/item/claude-code/nope/config`)).status, 404)
    assert.equal((await fetch(`${base}/api/item/claude-code/..%2Fx/config`)).status, 400)
  })
  // No home given: nothing configured, calls still listed as unconfigured
  await withServer([create({ root: claudeRoot })], {}, async (base) => {
    const r = await (await fetch(`${base}/api/item/claude-code/s1/config`)).json()
    assert.ok(r.servers.every((s) => s.configured === false))
  })
})

test("conflicts routes: two sessions of one project editing the same file show on the project and on both items", async () => {
  const root = mkdtempSync(join(tmpdir(), "mc-conf-"))
  const NOW = Date.now() // listItems dates items by file mtime, so the clock is the real one
  const ts = (min) => new Date(NOW - min * 60000).toISOString()
  const sess = (dir, id, cwd, branch, file, min) => {
    mkdirSync(join(root, dir), { recursive: true })
    writeFileSync(join(root, dir, `${id}.jsonl`), [
      JSON.stringify({ type: "user", cwd, gitBranch: branch, timestamp: ts(min + 1), message: { content: "go" } }),
      JSON.stringify({ type: "assistant", cwd, timestamp: ts(min), message: { id: `m-${id}`, model: "claude-sonnet-4-5", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "tool_use", id: `t-${id}`, name: "Edit", input: { file_path: `${cwd}/${file}` } }] } }),
    ].join("\n") + "\n")
  }
  sess("-repo", "a1", "/repo", "main", "src/api.ts", 6)
  sess("-wt-search", "b1", "/wt/search", "feat/search", "src/api.ts", 2)
  sess("-other", "c1", "/other", "main", "src/api.ts", 3)
  // /repo and /wt/search are worktrees of one repo; /other is a project of its own
  const git = {
    resolve: async (cwd) => (cwd === "/other" ? null : { commonDir: "/repo/.git", toplevel: cwd }),
    worktrees: async () => [{ path: "/repo", branch: "main" }, { path: "/wt/search", branch: "feat/search" }],
    status: async () => null,
  }
  await withServer([create({ root, now: () => NOW })], { git, now: () => NOW }, async (base) => {
    const items = await (await fetch(`${base}/api/items?all=1`)).json()
    const key = items.find((i) => i.id === "a1").project.key
    const p = await (await fetch(`${base}/api/project/${key}/conflicts`)).json()
    assert.equal(p.warnings.length, 1)
    assert.equal(p.warnings[0].text, "repo in feat/search and main both edited src/api.ts 4m apart")
    for (const id of ["a1", "b1"]) assert.equal((await (await fetch(`${base}/api/item/claude-code/${id}/conflicts`)).json()).warnings.length, 1, id)
    assert.deepEqual((await (await fetch(`${base}/api/item/claude-code/c1/conflicts`)).json()).warnings, [])
    assert.equal((await fetch(`${base}/api/project/nope-1/conflicts`)).status, 404)
  })
})

test("turn-costs route: a session's turns; bad lane 400; a source without turns 404", async () => {
  await withServer([create({ root: claudeRoot })], {}, async (base) => {
    const r = await (await fetch(`${base}/api/item/claude-code/s1/turn-costs`)).json()
    assert.equal(r.lane, "main")
    assert.ok(r.turns.length > 0 && r.turns.every((t) => typeof t.cost === "number" && typeof t.context === "number"))
    assert.equal((await fetch(`${base}/api/item/claude-code/s1/turn-costs?lane=..%2Fx`)).status, 400)
    assert.equal((await fetch(`${base}/api/item/claude-code/s1/turn-costs?lane=agent-zz`)).status, 404)
  })
})
