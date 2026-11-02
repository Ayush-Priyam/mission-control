// Budgets from ~/.mission-control/config.json:
//   { "budgets": [ { "scope": "project"|"worktree"|"branch", "match": "<name, path or glob*>", "daily"?: usd, "weekly"?: usd, "monthly"?: usd } ] }
// Periods are rolling: daily = today, weekly = the last 7 days, monthly = the last 30 days (local days in tz).
// Spend is the same list-price estimate as the Usage page.
import { readFileSync, statSync } from "node:fs"
import { shiftDay } from "./usage.mjs"

const SCOPES = new Set(["project", "worktree", "branch"])
const PERIODS = { daily: 1, weekly: 7, monthly: 30 }
export const WARN_AT = 0.8

/** Valid budget entries of a parsed config ([] for anything else). */
export function parseBudgets(raw) {
  const list = Array.isArray(raw?.budgets) ? raw.budgets : []
  const out = []
  for (const b of list) {
    if (!b || typeof b !== "object" || !SCOPES.has(b.scope) || typeof b.match !== "string" || !b.match || b.match.length > 500) continue
    const limits = {}
    for (const p of Object.keys(PERIODS)) if (typeof b[p] === "number" && Number.isFinite(b[p]) && b[p] > 0) limits[p] = b[p]
    if (Object.keys(limits).length) out.push({ scope: b.scope, match: b.match, ...limits })
  }
  return out
}

/** `{ list() }` re-reading the config when it changes; any problem means []. */
export function createBudgets(configPath) {
  let seen = null, list = []
  return {
    list() {
      if (!configPath) return []
      let st
      try { st = statSync(configPath) } catch { seen = null; list = []; return list }
      const stamp = `${st.mtimeMs}|${st.size}`
      if (stamp === seen) return list
      seen = stamp
      try { list = parseBudgets(JSON.parse(readFileSync(configPath, "utf8"))) } catch { list = [] }
      return list
    },
  }
}

const base = (p) => String(p ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).pop()
function like(value, pattern) {
  if (!value) return false
  if (pattern.endsWith("*")) return value.startsWith(pattern.slice(0, -1))
  return value === pattern
}
/** Does a usage row (named: project key, projectName, projectPath, worktree, branch) fall under a budget? */
export function inScope(b, r) {
  if (b.scope === "project") return [r.projectName, r.projectPath, r.project].some((v) => like(v, b.match))
  if (b.scope === "worktree") return like(r.worktree, b.match) || like(base(r.worktree), b.match)
  return like(r.branch, b.match)
}

/**
 * Spend against each budget and period over named usage rows of the last 30 days.
 * -> [{ scope, match, period, limit, spent, ratio, level: "ok"|"warn"|"over" }], fullest first.
 */
export function evaluateBudgets(budgets, rows, { today }) {
  const out = []
  for (const b of budgets) for (const [period, days] of Object.entries(PERIODS)) {
    if (b[period] === undefined) continue
    const from = shiftDay(today, -(days - 1))
    let spent = 0
    for (const r of rows) if (r.day >= from && r.day <= today && inScope(b, r)) spent += r.cost
    const ratio = spent / b[period]
    out.push({ scope: b.scope, match: b.match, period, limit: b[period], spent, ratio, level: ratio >= 1 ? "over" : ratio >= WARN_AT ? "warn" : "ok" })
  }
  return out.sort((a, b) => b.ratio - a.ratio)
}
