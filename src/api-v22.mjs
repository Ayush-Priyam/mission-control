// v2.2 routes, kept apart from server.mjs so they merge cleanly: config joins, and (added by later items)
// same-file warnings, turns, budgets, PRs and the usage-window forecast. Each handler returns
// { body, status? } or null when the route is not one of these.
import { joinConfig, readClaudeConfig, readCodexConfig, unusedServers } from "./config.mjs"
import { buildTree, projectsOf } from "./projects.mjs"
import { sameFileWarnings, warningText, WINDOW_MS } from "./conflicts.mjs"
import { evaluateBudgets } from "./budgets.mjs"
import { prUsage } from "./prs.mjs"
import { forecastWindow } from "./forecast.mjs"
import { bucketOf } from "./usage.mjs"
import { defaultTz, isTz, localDay, shiftDay } from "./usage.mjs"

const DAY = /^\d{4}-\d{2}-\d{2}$/
/** Usage rows of a range with project key, name and path (as /api/usage names them) and the worktree. */
export async function namedRows(ctx, range) {
  const rows = await ctx.registry.usage(range)
  const where = await projectsOf(rows.map((r) => r.project), { git: ctx.git })
  return rows.map((r) => {
    const p = where.get(r.project)
    return p ? { ...r, project: p.key, projectName: p.name, projectPath: p.path, worktree: p.worktree || r.worktree } : { ...r, project: "no-project", projectName: "(no project)", projectPath: "" }
  })
}
const todayIn = (ctx, tz) => localDay(new Date((ctx.now ?? Date.now)()).toISOString(), tz)

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
  // GET /api/item/:source/:id/turn-costs?lane=
  if (get && parts[0] === "item" && parts[3] === "turn-costs" && parts.length === 4) {
    const [source, id] = [parts[1], parts[2]]
    const lane = q?.get("lane") ?? "main"
    if (!isKey(source) || !isKey(id) || !/^[\w-]{1,128}$/.test(lane)) return bad
    const src = registry.source(source)
    const r = src?.getTurnCosts ? await src.getTurnCosts(id, lane) : null
    return r ? { body: r } : { body: { error: "not found" }, status: 404 }
  }
  // GET /api/usage/prs?from&to&tz: cost per pull request (branches that map to a PR through gh)
  if (get && parts[0] === "usage" && parts[1] === "prs" && parts.length === 2) {
    const from = q.get("from") ?? undefined, to = q.get("to") ?? undefined, tz = q.get("tz") ?? defaultTz()
    if ((from && !DAY.test(from)) || (to && !DAY.test(to)) || !isTz(tz)) return bad
    if (!ctx.prs) return { body: { gh: false, rows: [] } }
    const rows = await prUsage(await namedRows(ctx, { from, to, tz }), ctx.prs)
    return { body: { gh: ctx.prs.available() !== false, rows } }
  }
  // GET /api/budgets?tz: spend against each configured budget
  if (get && parts[0] === "budgets" && parts.length === 1) {
    const tz = q.get("tz") ?? defaultTz()
    if (!isTz(tz)) return bad
    const list = ctx.budgets?.list() ?? []
    if (!list.length) return { body: { budgets: [] } }
    const today = todayIn(ctx, tz)
    const rows = await namedRows(ctx, { from: shiftDay(today, -29), to: today, tz })
    return { body: { today, budgets: evaluateBudgets(list, rows, { today }) } }
  }
  // GET /api/usage-window: Claude Code's current rolling window, estimated from local logs
  if (get && parts[0] === "usage-window" && parts.length === 1) {
    const src = registry.sources().find((x) => x.harness === "claude-code" && typeof x.usageBuckets === "function")
    if (!src) return { body: { available: false } }
    const cfg = ctx.windowConfig?.get() ?? { hours: 5 }
    const now = (ctx.now ?? Date.now)()
    // Windows chain from the last 24 h of activity (an estimate: a chain older than that is not followed).
    const since = bucketOf(new Date(now - Math.max(24, cfg.hours * 2) * 3600_000).toISOString())
    const buckets = await src.usageBuckets(since)
    return { body: { available: true, harness: "claude-code", estimate: true, complete: src.usageStatus?.().complete ?? true, ...forecastWindow(buckets, { now, ...cfg }) } }
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
