import { test } from "node:test"
import assert from "node:assert/strict"
import { editedPaths, repoRelative, sameFileWarnings, warningText } from "../src/conflicts.mjs"

const NOW = Date.parse("2026-11-02T12:00:00Z")
const at = (minAgo) => new Date(NOW - minAgo * 60000).toISOString()
const edit = (path, minAgo, extra = {}) => ({ name: "Edit", kind: "tool", ts: at(minAgo), input: { file_path: path }, ok: true, ...extra })
const item = (id, branch, worktree, calls, source = "claude-code") => ({ source, id, title: `t-${id}`, branch, worktree, cwd: worktree, calls })

test("edited paths: Claude Edit/Write, Codex apply_patch headers, nothing for reads", () => {
  assert.deepEqual(editedPaths(edit("/r/a.ts", 0)), ["/r/a.ts"])
  assert.deepEqual(editedPaths({ name: "Write", input: { file_path: "/r/b.ts" } }), ["/r/b.ts"])
  assert.deepEqual(editedPaths({ name: "apply_patch", input: { input: "*** Begin Patch\n*** Update File: src/api.ts\n@@\n*** Add File: src/new.ts\n" } }), ["src/api.ts", "src/new.ts"])
  assert.deepEqual(editedPaths({ name: "apply_patch", input: { input: "*** Begin Patch\n…" }, summary: "src/x.ts (+2 more)" }), ["src/x.ts"])
  assert.deepEqual(editedPaths({ name: "Read", input: { file_path: "/r/a.ts" } }), [])
  assert.equal(repoRelative("/wt/feat/src/api.ts", "/wt/feat"), "src/api.ts")
  assert.equal(repoRelative("/elsewhere/x.ts", "/wt/feat"), null)
  assert.equal(repoRelative("./src/api.ts", "/wt/feat"), "src/api.ts")
})

test("two worktrees editing the same repo-relative path within 30 min warn; text names both branches", () => {
  const ws = sameFileWarnings([
    item("s1", "feat/search", "/wt/search", [edit("/wt/search/src/api.ts", 2)]),
    item("s2", "main", "/repo", [edit("/repo/src/api.ts", 6), edit("/repo/src/other.ts", 6)]),
    item("c1", "main", "/repo", [{ name: "apply_patch", ts: at(20), input: { input: "*** Update File: src/api.ts\n" } }], "codex"),
  ], { now: NOW })
  assert.deepEqual(ws.map((w) => [w.path, w.a.id, w.b.id, w.gapMs / 60000]), [["src/api.ts", "s1", "s2", 4], ["src/api.ts", "s1", "c1", 18], ["src/api.ts", "s2", "c1", 14]])
  assert.equal(warningText(ws[0], "frontend"), "frontend in feat/search and main both edited src/api.ts 4m apart")
  assert.equal(warningText(ws[2], "frontend"), "frontend in main (two sessions) both edited src/api.ts 14m apart")
})

test("no warning: one session editing twice, edits older than 30 min, more than 30 min apart, failed edits, different files", () => {
  assert.deepEqual(sameFileWarnings([item("s1", "main", "/r", [edit("/r/a.ts", 1), edit("/r/a.ts", 5)])], { now: NOW }), [])
  assert.deepEqual(sameFileWarnings([item("s1", "a", "/r", [edit("/r/a.ts", 40)]), item("s2", "b", "/w", [edit("/w/a.ts", 45)])], { now: NOW }), [])
  assert.deepEqual(sameFileWarnings([item("s1", "a", "/r", [edit("/r/a.ts", 1, { ok: false })]), item("s2", "b", "/w", [edit("/w/a.ts", 3)])], { now: NOW }), [])
  assert.deepEqual(sameFileWarnings([item("s1", "a", "/r", [edit("/r/a.ts", 1)]), item("s2", "b", "/w", [edit("/w/b.ts", 3)])], { now: NOW }), [])
})

test("a resumed or forked session replaying history: identical timestamp and path in two items is not a warning", () => {
  const ws = sameFileWarnings([
    item("orig", "main", "/repo", [edit("/repo/src/api.ts", 5)]),
    item("fork", "main", "/repo", [edit("/repo/src/api.ts", 5), edit("/repo/src/b.ts", 1)]),
    item("other", "feat/x", "/wt/x", [edit("/wt/x/src/b.ts", 3)]),
  ], { now: NOW })
  assert.deepEqual(ws.map((w) => [w.path, w.a.id, w.b.id]), [["src/b.ts", "fork", "other"]])
})
