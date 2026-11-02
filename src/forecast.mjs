// Usage-window forecast for Claude Code: an ESTIMATE of the current rolling window from local logs.
// Anthropic's real window and limits are not public and are not read here; the window length and any
// limit are the owner's own settings in ~/.mission-control/config.json:
//   { "usageWindow": { "hours": 5, "limitTokens"?: number, "limitUsd"?: number } }
// Tokens counted = input + output + cache write (cache reads excluded: they are billed far lower).
import { readFileSync, statSync } from "node:fs"

const BUCKET_MS = 15 * 60 * 1000
export const DEFAULT_HOURS = 5

/** { hours, limitTokens?, limitUsd? } from a parsed config; defaults for anything missing or invalid. */
export function parseWindow(raw) {
  const w = raw && typeof raw === "object" ? raw.usageWindow : null
  const pos = (v) => typeof v === "number" && Number.isFinite(v) && v > 0
  const out = { hours: w && pos(w.hours) && w.hours <= 24 * 7 ? w.hours : DEFAULT_HOURS }
  if (w && pos(w.limitTokens)) out.limitTokens = w.limitTokens
  if (w && pos(w.limitUsd)) out.limitUsd = w.limitUsd
  return out
}

/** `{ get() }` re-reading the config when it changes. */
export function createWindowConfig(configPath) {
  let seen = null, value = parseWindow(null)
  return {
    get() {
      if (!configPath) return parseWindow(null)
      let st
      try { st = statSync(configPath) } catch { seen = null; value = parseWindow(null); return value }
      const stamp = `${st.mtimeMs}|${st.size}`
      if (stamp === seen) return value
      seen = stamp
      try { value = parseWindow(JSON.parse(readFileSync(configPath, "utf8"))) } catch { value = parseWindow(null) }
      return value
    },
  }
}

const bucketMs = (b) => Date.parse(`${b}:00Z`)
const counted = (x) => x.in + x.out + x.cacheWrite

/**
 * buckets: [{ b, in, out, cacheRead, cacheWrite, cost }] ascending (15-minute UTC buckets). A window opens at
 * the first activity after the previous window ended and lasts `hours`. Returns the estimate:
 * { active, start, resetsAt, used: { tokens, cost }, rate: { tokensPerHour, usdPerHour }, limit, eta, hitsBeforeReset, message }.
 * eta (ms from now) is set only when a limit is set and the current rate reaches it before the reset.
 */
export function forecastWindow(buckets, { now, hours = DEFAULT_HOURS, limitTokens, limitUsd } = {}) {
  const len = hours * 3600_000
  let start = null
  for (const x of buckets) {
    const t = bucketMs(x.b)
    if (!Number.isFinite(t) || t > now || counted(x) + x.cacheRead === 0) continue
    if (start === null || t >= start + len) start = t
  }
  const limit = limitTokens || limitUsd ? { ...(limitTokens ? { tokens: limitTokens } : {}), ...(limitUsd ? { usd: limitUsd } : {}) } : null
  if (start === null || now >= start + len) {
    return { active: false, hours, start: null, resetsAt: null, used: { tokens: 0, cost: 0 }, rate: { tokensPerHour: 0, usdPerHour: 0 }, limit, eta: null, hitsBeforeReset: false, message: "No usage window open: nothing in the last " + `${hours} h.` }
  }
  let tokens = 0, cost = 0
  for (const x of buckets) { const t = bucketMs(x.b); if (t >= start && t <= now) { tokens += counted(x); cost += x.cost } }
  const elapsedH = Math.max(BUCKET_MS, now - start) / 3600_000
  const rate = { tokensPerHour: tokens / elapsedH, usdPerHour: cost / elapsedH }
  const resetsAt = start + len
  const left = resetsAt - now
  let eta = null
  if (limit) {
    const etas = []
    if (limit.tokens) etas.push(tokens >= limit.tokens ? 0 : rate.tokensPerHour > 0 ? ((limit.tokens - tokens) / rate.tokensPerHour) * 3600_000 : Infinity)
    if (limit.usd) etas.push(cost >= limit.usd ? 0 : rate.usdPerHour > 0 ? ((limit.usd - cost) / rate.usdPerHour) * 3600_000 : Infinity)
    eta = Math.min(...etas)
  }
  const hitsBeforeReset = eta !== null && eta < left
  const message = !limit ? `No limit set · window resets in ~${dur(left)}`
    : eta === 0 ? "Over your limit for this window (estimate)"
    : hitsBeforeReset ? `At this rate you hit the limit in ~${dur(eta)}`
    : `At this rate you stay under the limit; the window resets in ~${dur(left)}`
  return { active: true, hours, start: new Date(start).toISOString(), resetsAt: new Date(resetsAt).toISOString(), used: { tokens, cost }, rate, limit, eta: Number.isFinite(eta) ? eta : null, hitsBeforeReset, message }
}

/** "1h 40m", "25m" */
export function dur(ms) {
  const m = Math.max(0, Math.round(ms / 60000))
  const h = Math.floor(m / 60)
  return h ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`
}
