// Usage aggregation. Sources emit UsageRow[] (one per day per session per model); this folds them.
const BY = new Set(["model", "project", "harness", "day", "worktree", "branch"])
export const isBy = (v) => BY.has(v)

const zero = () => ({ in: 0, out: 0, cacheRead: 0, cacheWrite: 0, cost: 0 })
const addTo = (a, r) => { a.in += r.in; a.out += r.out; a.cacheRead += r.cacheRead; a.cacheWrite += r.cacheWrite; a.cost += r.cost }

/** Distinct sessions are counted by (source, session); rows without a session id each count as their own `sessions`. */
const sessionKey = (r, i) => (r.session != null ? `${r.source}|${r.session}` : `${r.source}|row${i}`)

/**
 * aggregate(rows, { by }) -> { totals, series, groups }.
 * series: one entry per day (ascending) with token sums, cost, sessions and `byKey` (cost per group key that day).
 * groups: one entry per `by` key, largest cost first: { key, name?, in, out, cacheRead, cacheWrite, cost, sessions }.
 */
export function aggregate(rows, { by = "model" } = {}) {
  if (!BY.has(by)) throw new Error(`by must be one of ${[...BY].join(", ")}`)
  const totals = { ...zero(), sessions: 0 }
  const allSessions = new Set()
  const days = new Map()
  const groups = new Map()
  rows.forEach((r, i) => {
    const key = String(by === "day" ? r.day : (r[by] ?? "") || "(none)")
    const sk = sessionKey(r, i)
    addTo(totals, r)
    allSessions.add(sk)
    const d = days.get(r.day) ?? { day: r.day, ...zero(), sessions: new Set(), byKey: {} }
    days.set(r.day, d)
    addTo(d, r)
    d.sessions.add(sk)
    d.byKey[key] = (d.byKey[key] ?? 0) + r.cost
    const g = groups.get(key) ?? { key, ...zero(), sessions: new Set() }
    groups.set(key, g)
    addTo(g, r)
    g.sessions.add(sk)
    if (by === "project" && r.projectName && !g.name) g.name = r.projectName
  })
  totals.sessions = allSessions.size
  const series = [...days.values()].map((d) => ({ ...d, sessions: d.sessions.size })).sort((a, b) => a.day.localeCompare(b.day))
  const out = [...groups.values()].map((g) => ({ ...g, sessions: g.sessions.size })).sort((a, b) => b.cost - a.cost || a.key.localeCompare(b.key))
  return { totals, series, groups: out }
}
