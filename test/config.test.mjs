import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { joinConfig, readClaudeConfig, readCodexConfig, unusedServers } from "../src/config.mjs"

const SECRET = "sk-test-SECRET-VALUE"
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "mc-cfg-home-"))
  const proj = mkdtempSync(join(tmpdir(), "mc-cfg-proj-"))
  writeFileSync(join(home, ".claude.json"), JSON.stringify({
    mcpServers: { docs: { command: "npx", env: { TOKEN: SECRET } }, "web.search": { url: "https://x", headers: { Authorization: SECRET } } },
    projects: { [proj]: { mcpServers: { localdb: { command: "db" } }, disabledMcpServers: ["web.search"] } },
  }))
  mkdirSync(join(home, ".claude", "skills", "brainstorming"), { recursive: true })
  writeFileSync(join(home, ".claude", "skills", "brainstorming", "SKILL.md"), "x")
  mkdirSync(join(home, ".claude", "skills", "not-a-skill"), { recursive: true })
  writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ env: { KEY: SECRET }, enabledPlugins: { "caveman@caveman": true, "off@x": false } }))
  writeFileSync(join(proj, ".mcp.json"), JSON.stringify({ mcpServers: { tracker: { env: { T: SECRET } } } }))
  mkdirSync(join(proj, ".claude", "skills", "deploy"), { recursive: true })
  writeFileSync(join(proj, ".claude", "skills", "deploy", "SKILL.md"), "x")
  writeFileSync(join(proj, ".claude", "settings.local.json"), JSON.stringify({ enabledPlugins: { "review@kit": true } }))
  return { home, proj }
}

test("claude config: names only from every file; disabled servers dropped; never a value", () => {
  const { home, proj } = fixture()
  const c = readClaudeConfig({ home, project: proj })
  assert.deepEqual(c.mcpServers, [{ name: "docs", scope: "user" }, { name: "localdb", scope: "local" }, { name: "tracker", scope: "project" }])
  assert.deepEqual(c.skills.map((s) => [s.name, s.scope]), [["brainstorming", "user"], ["deploy", "project"]])
  assert.deepEqual(c.plugins.map((p) => p.name), ["caveman@caveman", "review@kit"])
  assert.ok(!JSON.stringify(c).includes(SECRET))
  assert.ok(!JSON.stringify(c).includes("npx"))
})

test("claude config: missing or broken files are empty, never a throw", () => {
  const home = mkdtempSync(join(tmpdir(), "mc-cfg-empty-"))
  writeFileSync(join(home, ".claude.json"), "{ not json")
  assert.deepEqual(readClaudeConfig({ home, project: "/no/such/dir" }), { mcpServers: [], skills: [], plugins: [] })
  assert.deepEqual(readClaudeConfig({}), { mcpServers: [], skills: [], plugins: [] })
})

test("codex config: [mcp_servers.<name>] table names, sub-tables folded, no values", () => {
  const codexHome = mkdtempSync(join(tmpdir(), "mc-cfg-codex-"))
  writeFileSync(join(codexHome, "config.toml"), `model = "gpt-5"\n[mcp_servers.docs]\ncommand = "npx"\nenv = { TOKEN = "${SECRET}" }\n[mcp_servers.docs.tools.query]\nenabled = true\n[mcp_servers."my server"]\nurl = "x"\n`)
  const c = readCodexConfig({ codexHome })
  assert.deepEqual(c.mcpServers.map((s) => s.name), ["docs", "my server"])
  assert.ok(!JSON.stringify(c).includes(SECRET))
  assert.deepEqual(readCodexConfig({ codexHome: "/no/such" }).mcpServers, [])
})

test("join: used / loaded-but-unused / failing by error rate; unconfigured calls listed; plugin-prefixed servers match", () => {
  const config = { mcpServers: [{ name: "docs", scope: "user" }, { name: "localdb", scope: "local" }, { name: "web.search", scope: "user" }, { name: "figma", scope: "user" }], skills: [{ name: "brainstorming", scope: "user" }, { name: "deploy", scope: "project" }], plugins: [] }
  const calls = [
    { kind: "mcp", server: "docs", name: "q", ok: true },
    { kind: "mcp", server: "docs", name: "q", ok: false, error: "boom" },
    { kind: "mcp", server: "docs", name: "q", ok: true },
    { kind: "mcp", server: "web_search", name: "s", ok: false },
    { kind: "mcp", server: "plugin_design_figma", name: "get", ok: true },
    { kind: "mcp", server: "stray", name: "x", ok: true },
    { kind: "skill", name: "superpowers:brainstorming", ok: true },
    { kind: "tool", name: "Bash", ok: false },
  ]
  const j = joinConfig(config, calls)
  const s = Object.fromEntries(j.servers.map((x) => [x.name, x]))
  assert.deepEqual([s.docs.status, s.docs.calls, s.docs.errors], ["used", 3, 1])
  assert.deepEqual([s["web.search"].status, s["web.search"].errorRate], ["failing", 1])
  assert.equal(s.figma.status, "used")
  assert.equal(s.localdb.status, "unused")
  assert.deepEqual([s.stray.configured, s.stray.status], [false, "used"])
  assert.equal(j.servers[0].name, "web.search", "failing first")
  const k = Object.fromEntries(j.skills.map((x) => [x.name, x]))
  assert.deepEqual([k.brainstorming.status, k.deploy.status], ["used", "unused"])
  assert.deepEqual(unusedServers([j, joinConfig(config, [{ kind: "mcp", server: "localdb", ok: true }])]), [])
  assert.deepEqual(unusedServers([j]), [{ name: "localdb", scope: "local" }])
})
