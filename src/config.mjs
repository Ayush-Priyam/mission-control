// Read-only readers for what a harness has configured: MCP server names, skill names and plugin names.
// Names only, by design: values, commands, args, env, headers and tokens in these files are never read into
// a result, logged or sent anywhere. Every reader takes its home/dir as an option (tests use fixtures).
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const NAME = /^[\w@.:+ -]{1,128}$/
const okName = (n) => typeof n === "string" && NAME.test(n)
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null)

const memo = new Map() // path -> { stamp, value }
/** Parsed JSON of a file, cached by size+mtime; null when missing or broken. */
function readJson(path) {
  let st
  try { st = statSync(path) } catch { memo.delete(path); return null }
  const stamp = `${st.size}|${st.mtimeMs}`
  const hit = memo.get(path)
  if (hit && hit.stamp === stamp) return hit.value
  let value = null
  try { value = obj(JSON.parse(readFileSync(path, "utf8"))) } catch { value = null }
  if (memo.size > 256) memo.delete(memo.keys().next().value)
  memo.set(path, { stamp, value })
  return value
}
const keys = (o) => Object.keys(obj(o) ?? {}).filter(okName)
const dirs = (p) => { try { return readdirSync(p, { withFileTypes: true }) } catch { return [] } }

/** Skill folders (a directory holding SKILL.md) under a skills dir. */
function skillDirs(dir) {
  const out = []
  for (const d of dirs(dir)) {
    if (!d.isDirectory() || d.name.startsWith(".") || !okName(d.name)) continue
    try { if (statSync(join(dir, d.name, "SKILL.md")).isFile()) out.push(d.name) } catch { /* not a skill */ }
  }
  return out.sort()
}

/**
 * Claude Code: MCP servers from ~/.claude.json (user scope, and the project entry's local scope minus its
 * disabledMcpServers) and <project>/.mcp.json; plugins enabled in ~/.claude/settings.json and the project's
 * .claude/settings.json / settings.local.json; skills in ~/.claude/skills and <project>/.claude/skills.
 * { mcpServers: [{ name, scope }], skills: [{ name, scope }], plugins: [{ name, scope }] }
 */
export function readClaudeConfig({ home, project = null } = {}) {
  const servers = new Map(), skills = new Map(), plugins = new Map()
  const put = (m, name, scope) => { if (!m.has(name)) m.set(name, { name, scope }) }
  if (home) {
    const cj = readJson(join(home, ".claude.json"))
    for (const n of keys(cj?.mcpServers)) put(servers, n, "user")
    const p = project ? obj(obj(cj?.projects)?.[project]) : null
    const disabled = new Set(Array.isArray(p?.disabledMcpServers) ? p.disabledMcpServers : [])
    for (const n of keys(p?.mcpServers)) put(servers, n, "local")
    for (const n of [...servers.keys()]) if (disabled.has(n)) servers.delete(n)
    const st = readJson(join(home, ".claude", "settings.json"))
    for (const [n, on] of Object.entries(obj(st?.enabledPlugins) ?? {})) if (on === true && okName(n)) put(plugins, n, "user")
    for (const n of skillDirs(join(home, ".claude", "skills"))) put(skills, n, "user")
  }
  if (project) {
    for (const n of keys(readJson(join(project, ".mcp.json"))?.mcpServers)) put(servers, n, "project")
    for (const f of ["settings.json", "settings.local.json"]) {
      for (const [n, on] of Object.entries(obj(readJson(join(project, ".claude", f))?.enabledPlugins) ?? {})) if (on === true && okName(n)) put(plugins, n, "project")
    }
    for (const n of skillDirs(join(project, ".claude", "skills"))) put(skills, n, "project")
  }
  return { mcpServers: [...servers.values()], skills: [...skills.values()], plugins: [...plugins.values()] }
}

/**
 * Codex: [mcp_servers.<name>] table names in <codexHome>/config.toml (sub-tables such as
 * [mcp_servers.x.tools.y] name the same server). No TOML values are read.
 */
export function readCodexConfig({ codexHome } = {}) {
  const names = new Set()
  if (codexHome) {
    let text = ""
    try { text = readFileSync(join(codexHome, "config.toml"), "utf8") } catch { /* no config */ }
    for (const m of text.matchAll(/^\s*\[\s*mcp_servers\.(?:"([^"\n]+)"|'([^'\n]+)'|([\w-]+))/gm)) {
      const n = m[1] ?? m[2] ?? m[3]
      if (okName(n)) names.add(n)
    }
  }
  return { mcpServers: [...names].sort().map((name) => ({ name, scope: "user" })), skills: [], plugins: [] }
}

/** The name an MCP server's tools carry in calls (mcp__<norm>__tool): anything but [A-Za-z0-9_-] becomes "_". */
export const normServer = (n) => String(n).replace(/[^\w-]/g, "_")
const FAILING_RATE = 0.5

/**
 * Join configured names with the calls of a session. Each configured server and skill is
 * "used" (called, error rate under 50%), "failing" (called, at least half the calls errored) or "unused"
 * (configured, loaded, never called). Servers and skills called but not in the config are listed with
 * `configured: false`. Calls with ok === false or an error count as errors.
 */
export function joinConfig(config, calls) {
  const tally = (key, m, c) => {
    const t = m.get(key) ?? m.set(key, { calls: 0, errors: 0 }).get(key)
    t.calls++
    if (c.ok === false || c.error) t.errors++
  }
  const byServer = new Map(), bySkill = new Map()
  for (const c of calls ?? []) {
    if (c.kind === "mcp" && c.server) tally(c.server, byServer, c)
    else if (c.kind === "skill" && c.name) tally(c.name, bySkill, c)
  }
  const state = (t) => (!t ? "unused" : t.errors / t.calls >= FAILING_RATE ? "failing" : "used")
  const row = (name, scope, t, configured = true) => ({ name, scope, configured, status: state(t), calls: t?.calls ?? 0, errors: t?.errors ?? 0, errorRate: t ? t.errors / t.calls : 0 })
  const seenS = new Set(), seenK = new Set()
  const servers = config.mcpServers.map((s) => {
    // A plugin's server is called as mcp__plugin_<plugin>_<server>__*: match the plain name or that suffix.
    const n = normServer(s.name)
    const key = [...byServer.keys()].find((k) => k === n || k.endsWith(`_${n}`)) ?? n
    seenS.add(key)
    return row(s.name, s.scope, byServer.get(key))
  })
  for (const [k, t] of byServer) if (!seenS.has(k)) servers.push(row(k, null, t, false))
  const skills = config.skills.map((s) => {
    const key = [...bySkill.keys()].find((k) => k === s.name || k.endsWith(`:${s.name}`)) ?? s.name
    seenK.add(key)
    return row(s.name, s.scope, bySkill.get(key))
  })
  for (const [k, t] of bySkill) if (!seenK.has(k)) skills.push(row(k, null, t, false))
  const order = { failing: 0, used: 1, unused: 2 }
  const sort = (a, b) => order[a.status] - order[b.status] || b.calls - a.calls || a.name.localeCompare(b.name)
  return { servers: servers.sort(sort), skills: skills.sort(sort), plugins: config.plugins.map((p) => p.name) }
}

/**
 * Project level: configured MCP servers that none of the given sessions called. `joins` are joinConfig
 * results of the project's recent sessions. [{ name, scope }]
 */
export function unusedServers(joins) {
  const configured = new Map(), used = new Set()
  for (const j of joins) for (const s of j.servers) {
    if (!s.configured) continue
    if (!configured.has(s.name)) configured.set(s.name, s.scope)
    if (s.calls > 0) used.add(s.name)
  }
  return [...configured].filter(([n]) => !used.has(n)).map(([name, scope]) => ({ name, scope })).sort((a, b) => a.name.localeCompare(b.name))
}
