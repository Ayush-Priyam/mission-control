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
