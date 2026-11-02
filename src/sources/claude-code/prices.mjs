// Price table for cost estimates, USD per million tokens, by model family and version.
//
// LIST-PRICE ESTIMATE as of 2026-11-02: list prices drift, plans and discounts differ, and the
// numbers are what a pay-as-you-go API key would be charged. Edit them when they go stale. Cache write
// is billed at 1.25x input and cache read at 0.1x input, which is how those columns are derived.
// Unknown models cost 0 (shown as "–", no price).
//
//   opus 4 / 4.1 (and older)   $15 in / $75 out
//   opus 4.5 and later         $5 / $25    (incl. opus-5*; a bare "opus" is taken as the latest)
//   sonnet (all versions)      $3 / $15
//   haiku below 4.5 (3.5)      $0.80 / $4
//   haiku 4.5 and later        $1 / $5     (a bare "haiku" is taken as the latest)
const row = (input, output) => ({ input, output, cacheWrite: input * 1.25, cacheRead: input * 0.1 })
export const PRICES = {
  "opus-4": row(15, 75),
  opus: row(5, 25),
  sonnet: row(3, 15),
  "haiku-3": row(0.8, 4),
  haiku: row(1, 5),
}
export const PRICES_AS_OF = "2026-11-02"

const FAMILIES = ["opus", "sonnet", "haiku"]

/**
 * Family and version of a model id: "claude-opus-4-1-20250805" -> { family: "opus", major: 4, minor: 1 },
 * "claude-3-5-haiku-20241022" -> haiku 3.5, "claude-opus-5-5" -> opus 5.5. A date suffix is never read as
 * a version. major is null when the id names no version (a bare "opus"). null for an unknown family.
 */
export function version(model) {
  const m = String(model ?? "").toLowerCase()
  const fam = FAMILIES.find((f) => m.includes(f))
  if (!fam) return null
  const after = new RegExp(`${fam}[-_ .]?(\\d{1,2})(?!\\d)(?:[-.](\\d{1,2})(?!\\d))?`).exec(m)
  const before = after ? null : new RegExp(`(?<!\\d)(\\d{1,2})(?:[-.](\\d{1,2}))?[-_ ]${fam}`).exec(m)
  const v = after ?? before
  return { family: fam, major: v ? Number(v[1]) : null, minor: v && v[2] ? Number(v[2]) : 0 }
}

/** The PRICES key for a model ("claude-opus-4-1" -> "opus-4", "claude-opus-5-5" -> "opus"); null when unknown. */
export function family(model) {
  const v = version(model)
  if (!v) return null
  const older = v.major !== null && v.major * 100 + v.minor < 405 // before 4.5
  if (v.family === "opus") return older ? "opus-4" : "opus"
  if (v.family === "haiku") return older ? "haiku-3" : "haiku"
  return v.family
}

// OpenAI models (Codex CLI), USD per million tokens. LIST-PRICE ESTIMATE as of 2026-11-02, shown as "est.":
// pay-as-you-go API prices; a ChatGPT plan is billed differently. OpenAI bills no cache-write premium, so cache
// write is priced as input. Only exact ids (after dropping a -YYYY-MM-DD suffix) are priced: a model not listed
// here, including any newer version, costs 0 and shows as "–" (no price) rather than borrowing an older price.
const oa = (input, output, cacheRead) => ({ input, output, cacheWrite: input, cacheRead })
export const OPENAI_PRICES = {
  "gpt-5": oa(1.25, 10, 0.125),
  "gpt-5-codex": oa(1.25, 10, 0.125),
  "gpt-5-mini": oa(0.25, 2, 0.025),
  "gpt-5-nano": oa(0.05, 0.4, 0.005),
  "gpt-5.1": oa(1.25, 10, 0.125),
  "gpt-5.1-codex": oa(1.25, 10, 0.125),
  "gpt-5.1-codex-max": oa(1.25, 10, 0.125),
  "gpt-5.1-codex-mini": oa(0.25, 2, 0.025),
  "gpt-4.1": oa(2, 8, 0.5),
  "gpt-4.1-mini": oa(0.4, 1.6, 0.1),
  "gpt-4o": oa(2.5, 10, 1.25),
  "gpt-4o-mini": oa(0.15, 0.6, 0.075),
  o3: oa(2, 8, 0.5),
  "o4-mini": oa(1.1, 4.4, 0.275),
  "codex-mini-latest": oa(1.5, 6, 0.375),
}

/** The OPENAI_PRICES row for a model id ("gpt-5-2025-08-07" -> gpt-5); null when not listed. */
export function openaiPrice(model) {
  const m = String(model ?? "").toLowerCase().trim().replace(/-\d{4}-\d{2}-\d{2}$/, "")
  return Object.hasOwn(OPENAI_PRICES, m) ? OPENAI_PRICES[m] : null
}

/** Estimated dollars for one usage record: { in, out, cacheRead, cacheWrite } token counts. */
export function costOf(model, t) {
  const p = PRICES[family(model)] ?? openaiPrice(model)
  if (!p) return 0
  return (t.in * p.input + t.out * p.output + t.cacheWrite * p.cacheWrite + t.cacheRead * p.cacheRead) / 1e6
}
