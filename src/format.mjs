import { existsSync, readFileSync } from "node:fs"

// Run-format helpers shared by the server and adapters.

/** Parse a .jsonl file. A missing file gives []; unparseable lines (e.g. half-written) and non-object lines are skipped. */
export function readJsonl(path) {
  if (!existsSync(path)) return []
  const out = []
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue
    try {
      const v = JSON.parse(line)
      if (v && typeof v === "object" && !Array.isArray(v)) out.push(v)
    } catch { /* skip */ }
  }
  return out
}

export { isRunId, isSessionName, capText } from "./names.mjs"
