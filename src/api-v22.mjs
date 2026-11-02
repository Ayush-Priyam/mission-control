// v2.2 routes, kept apart from server.mjs so they merge cleanly: config joins, and (added by later items)
// same-file warnings, turns, budgets, PRs and the usage-window forecast. Each handler returns
// { body, status? } or null when the route is not one of these.
import { joinConfig, readClaudeConfig, readCodexConfig, unusedServers } from "./config.mjs"
import { buildTree, projectsOf } from "./projects.mjs"
import { sameFileWarnings, warningText, WINDOW_MS } from "./conflicts.mjs"

const RECENT = 20 // sessions a project-level note looks at

/** The configured names for an item's harness (empty when the server was given no homes). */
export function configOf(ctx, harness, cwd) {
  if (harness === "claude-code") return readClaudeConfig({ home: ctx.claudeHome ?? null, project: cwd ?? null })
  if (harness === "codex") return readCodexConfig({ codexHome: ctx.codexHome ?? null })
  return { mcpServers: [], skills: [], plugins: [] }
}

/** The project's items (newest first) from a fresh tree. */
export async function projectItems(registry, git, key) {
  const p = (await buildTree(await registry.list(), { git, only: key })).find((x) => x.key === key)
  if (!p) return null
  return p.worktrees.flatMap((w) => w.items.map((i) => ({ ...i, worktree: w.path, wtBranch: w.branch }))).sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))
}

/** `parts` are the decoded path segments after /api; `isKey` validates ids; `q` the search params. */
/** Same-file warnings of one project: items updated in the last 30 min, their edit calls compared. */
export async function projectWarnings(ctx, key) {
  const { registry, git, now = () => Date.now() } = ctx
  const p = (await buildTree(await registry.list(), { git, only: key })).find((x) => x.key === key)
  if (!p) return null
  const t = now()
  const recent = p.worktrees.flatMap((w) => w.items.map((i) => ({ ...i, worktree: w.path, branch: i.branch ?? w.branch })))
    .filter((i) => t - Date.parse(i.updatedAt ?? "") <= WINDOW_MS)
  if (recent.length < 2) return { name: p.name, warnings: [] }
  for (const i of recent) i.calls = await registry.calls(i.source, i.id, {})
  return { name: p.name, warnings: sameFileWarnings(recent, { now: t }).map((w) => ({ ...w, text: warningText(w, p.name) })) }
}

export async function apiV22(ctx, { get, parts, isKey, q }) {
  const { registry, git } = ctx
  if (parts.some((p) => p === null)) return null
  const bad = { body: { error: "not allowed" }, status: 400 }
  // GET /api/item/:source/:id/config
  if (get && parts[0] === "item" && parts[3] === "config" && parts.length === 4) {
    const [source, id] = [parts[1], parts[2]]
    if (!isKey(source) || !isKey(id)) return bad
    const src = registry.source(source)
    const item = src ? await registry.get(source, id) : null
    if (!item) return { body: { error: "no such item" }, status: 404 }
    const calls = await registry.calls(source, id, {})
    const harness = item.summary.harness ?? src.harness
    return { body: { harness, ...joinConfig(configOf(ctx, harness, item.summary.cwd), calls) } }
  }
  // GET /api/project/:key/config
  if (get && parts[0] === "project" && parts[2] === "config" && parts.length === 3) {
    if (!isKey(parts[1])) return bad
    const items = await projectItems(registry, git, parts[1])
    if (!items) return { body: { error: "no such project" }, status: 404 }
    const recent = items.filter((i) => i.harness === "claude-code" || i.harness === "codex").slice(0, RECENT)
    const joins = []
    for (const i of recent) {
      const calls = await registry.calls(i.source, i.id, {})
      joins.push(joinConfig(configOf(ctx, i.harness, i.cwd), calls))
    }
    return { body: { sessions: recent.length, unusedServers: unusedServers(joins) } }
  }
  // GET /api/project/:key/conflicts
  if (get && parts[0] === "project" && parts[2] === "conflicts" && parts.length === 3) {
    if (!isKey(parts[1])) return bad
    const r = await projectWarnings(ctx, parts[1])
    return r ? { body: { warnings: r.warnings } } : { body: { error: "no such project" }, status: 404 }
  }
  // GET /api/item/:source/:id/conflicts: the project's warnings that involve this item
  if (get && parts[0] === "item" && parts[3] === "conflicts" && parts.length === 4) {
    const [source, id] = [parts[1], parts[2]]
    if (!isKey(source) || !isKey(id)) return bad
    const item = registry.source(source) ? await registry.get(source, id) : null
    if (!item) return { body: { error: "no such item" }, status: 404 }
    const cwd = item.summary.cwd
    const key = cwd ? (await projectsOf([cwd], { git })).get(cwd)?.key : null
    const r = key ? await projectWarnings(ctx, key) : null
    const mine = (x) => x.source === source && x.id === id
    return { body: { warnings: (r?.warnings ?? []).filter((w) => mine(w.a) || mine(w.b)) } }
  }
  return null
}
