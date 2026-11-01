import { existsSync, readFileSync } from "node:fs"

// Run-format helpers shared by the server and adapters.

/** Parse a .jsonl file. A missing file gives []; unparseable lines (e.g. half-written) are skipped. */
export function readJsonl(path) {
  if (!existsSync(path)) return []
  const out = []
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue
    try { out.push(JSON.parse(line)) } catch { /* skip */ }
  }
  return out
}

export const isRunId = (s) => typeof s === "string" && /^[\w-]+$/.test(s)
export const isSessionName = (s) => typeof s === "string" && /^[\w.-]+\.(md|jsonl)$/.test(s)

/** Session text, cut at `max` bytes; `truncated: true` only when cut. */
export function capText(buf, max = 200_000) {
  const truncated = buf.length > max
  const text = (truncated ? buf.subarray(0, max) : buf).toString("utf8")
  return truncated ? { text, truncated: true } : { text }
}
