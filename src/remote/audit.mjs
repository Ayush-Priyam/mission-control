// Append-only audit log <home>/.mission-control/audit.jsonl, mode 0600 (spec FR-22, contract C34, C43).
// Only hashes of targets and question texts are stored: never a raw command, path, question or option.
import { appendFileSync, chmodSync, mkdirSync } from "node:fs"
import { createHash } from "node:crypto"
import { join } from "node:path"

export const auditPath = (home) => join(home, ".mission-control", "audit.jsonl")
const sha256 = (s) => createHash("sha256").update(String(s)).digest("hex")

function append(home, line) {
  const dir = join(home, ".mission-control")
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const path = auditPath(home)
  // flag "a": open for appending only; mode applies when the file is created.
  appendFileSync(path, JSON.stringify(line) + "\n", { flag: "a", mode: 0o600 })
  try { chmodSync(path, 0o600) } catch { /* best effort */ }
}

/**
 * One accepted phone decision (C34): {ts, device, promptId, decision: allow|deny|answer, tool, targetHash}.
 * targetHash is the SHA-256 of the masked target, or for an ask of the question texts joined by "\n".
 */
export function appendAudit({ home, device, promptId, decision, tool, target, questions, now = Date.now() }) {
  const kind = decision === "allow" || decision === "deny" ? decision : "answer"
  const hashed = kind === "answer" && Array.isArray(questions) ? questions.map((q) => String(q?.question ?? "")).join("\n") : String(target ?? "")
  append(home, { ts: new Date(now).toISOString(), device: String(device), promptId: String(promptId), decision: kind, tool: String(tool ?? ""), targetHash: sha256(hashed) })
}

/** One actual remote on/off change (C43): {ts, actor: dashboard|cli, action: remote-on|remote-off}. */
export function appendToggle({ home, actor, enabled, now = Date.now() }) {
  append(home, { ts: new Date(now).toISOString(), actor, action: enabled ? "remote-on" : "remote-off" })
}
