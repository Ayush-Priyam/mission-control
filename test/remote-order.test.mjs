// The phone list: prompts the phone can answer come first (newest first), read-only ones after.
// Found on the owner's iPhone: a live prompt sat under four old read-only Ronin runs.
import { test } from "node:test"
import assert from "node:assert/strict"
import { joinEntries } from "../src/remote/prompts.mjs"

const ronin = (id, since) => ({ source: "ronin", harness: "ronin", id, title: id, since })
const pending = (sessionId, askedAt) => ({ promptId: `p-${sessionId}`, harness: "claude-code", sessionId, kind: "permission", tool: "Bash", target: "ls", askedAt, bind: "x" })

test("answerable prompts are listed before read-only entries, newest first", () => {
  const out = joinEntries(
    [ronin("r-old", "2026-10-12T00:00:00Z"), ronin("r-new", "2026-10-17T00:00:00Z")],
    [pending("s1", "2026-11-03T06:00:00Z"), pending("s2", "2026-11-03T06:05:00Z")],
  )
  assert.deepEqual(out.map((e) => e.id), ["s2", "s1", "r-new", "r-old"])
  assert.deepEqual(out.map((e) => e.answerable), [true, true, false, false])
})
