// Per-turn cost: one row per assistant turn (Claude Code: one per message id; Codex: one per token_count
// event), with its context size, cost and a hint at why it cost what it did. Pure; no file is read.

export const COMPACT_DROP = 0.5 // context fell to half or less ...
export const COMPACT_MIN = 20_000 // ... from at least this many tokens: a compaction (or a cleared context)
const BIG_WRITE = 10_000
const LONG_READ = 100_000
const LONG_OUT = 8_000

/** Why a turn cost what it did, in a few words (null when nothing stands out). */
export function whyExpensive(t) {
  const ctx = t.in + t.cacheRead + t.cacheWrite
  const why = []
  if (t.compacted) why.push("context compacted before this turn")
  if (t.cacheWrite >= BIG_WRITE && t.cacheWrite >= ctx * 0.5) why.push("large cache write: new context")
  else if (t.cacheWrite >= BIG_WRITE) why.push("cache write: context grew")
  if (t.cacheRead >= LONG_READ) why.push("high cache read: long context re-read")
  if (t.in >= BIG_WRITE && t.in >= ctx * 0.5) why.push("uncached input")
  if (t.out >= LONG_OUT) why.push("long output")
  return why.length ? why.join(" · ") : null
}

/**
 * messages: [{ model, ts, tokens: { in, out, cacheRead, cacheWrite } }] in file order (a parse result's
 * `messages`). -> { turns: [{ i, ts, model, in, out, cacheRead, cacheWrite, context, cost, compacted, why }],
 * total: { cost, turns, compactions } }. `context` is the prompt size (in + cache read + cache write).
 */
export function turnCosts(messages, costOf) {
  const turns = []
  let prev = null, total = 0, compactions = 0
  for (const m of messages ?? []) {
    const t = m.tokens ?? {}
    const row = { i: turns.length, ts: m.ts ?? null, model: m.model ?? null, in: t.in ?? 0, out: t.out ?? 0, cacheRead: t.cacheRead ?? 0, cacheWrite: t.cacheWrite ?? 0 }
    row.context = row.in + row.cacheRead + row.cacheWrite
    if (row.context === 0 && row.out === 0) continue // a bookkeeping record, not a turn
    row.cost = costOf(row.model, row)
    row.compacted = prev !== null && prev >= COMPACT_MIN && row.context <= prev * COMPACT_DROP
    if (row.compacted) compactions++
    row.why = whyExpensive(row)
    prev = row.context
    total += row.cost
    turns.push(row)
  }
  return { turns, total: { cost: total, turns: turns.length, compactions } }
}
