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

/** The server's local IANA zone. */
export const defaultTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"

/** True for an IANA zone name Intl accepts. */
export function isTz(tz) {
  if (typeof tz !== "string" || !tz) return false
  try { new Intl.DateTimeFormat("en-CA", { timeZone: tz }); return true } catch { return false }
}

const formatters = new Map()
const dayCaches = new Map()
/** Local calendar day (YYYY-MM-DD) in `tz` of a UTC instant (ISO string, or a 15-minute bucket "YYYY-MM-DDTHH:mm"). */
export function localDay(ts, tz) {
  let f = formatters.get(tz)
  if (!f) { f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }); formatters.set(tz, f) }
  let cache = dayCaches.get(tz)
  if (!cache) { cache = new Map(); dayCaches.set(tz, cache) }
  let d = cache.get(ts)
  if (d === undefined) {
    const t = /Z$|[+-]\d\d:?\d\d$/.test(ts) ? Date.parse(ts) : Date.parse(`${ts}${ts.length === 16 ? ":00" : ""}Z`)
    d = f.format(new Date(t))
    if (cache.size > 50_000) cache.clear()
    cache.set(ts, d)
  }
  return d
}

/** Shift a YYYY-MM-DD by whole days. */
export function shiftDay(day, n) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}

const TS = /^\d{4}-\d{2}-\d{2}T/
/** 15-minute UTC bucket "YYYY-MM-DDTHH:mm" of a timestamp, or null when it is not a valid ISO time. */
export function bucketOf(ts) {
  if (typeof ts !== "string" || !TS.test(ts)) return null
  const t = Date.parse(ts)
  if (!Number.isFinite(t)) return null
  const iso = new Date(t).toISOString()
  return `${iso.slice(0, 14)}${String(Math.floor(+iso.slice(14, 16) / 15) * 15).padStart(2, "0")}`
}
