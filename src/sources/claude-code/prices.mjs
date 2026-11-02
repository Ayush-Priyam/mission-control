// Price table for cost estimates, USD per million tokens, per model family.
//
// ESTIMATE ONLY: list prices drift, plans and discounts differ, and a family covers several model
// versions. Edit the numbers below when they go stale. Cache write is billed at 1.25x input and cache
// read at 0.1x input, which is how the rows are derived. Unknown models cost 0 (shown as unpriced).
export const PRICES = {
  opus: { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  sonnet: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  haiku: { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
}

/** "claude-opus-4-1-20250805" -> "opus"; null when the model is not a known family. */
export function family(model) {
  const m = String(model ?? "").toLowerCase()
  return Object.keys(PRICES).find((f) => m.includes(f)) ?? null
}

/** Estimated dollars for one usage record: { in, out, cacheRead, cacheWrite } token counts. */
export function costOf(model, t) {
  const p = PRICES[family(model)]
  if (!p) return 0
  return (t.in * p.input + t.out * p.output + t.cacheWrite * p.cacheWrite + t.cacheRead * p.cacheRead) / 1e6
}
