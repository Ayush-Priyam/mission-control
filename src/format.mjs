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

export { isRunId, isSessionName, capText } from "./names.mjs"
