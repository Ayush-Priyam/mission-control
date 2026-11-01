import { describe, expect, it } from "vitest"
import { extraTabs, normaliseDiff, normaliseTasks, qaRows, splitPatch } from "./extras"

describe("normaliseDiff", () => {
  it("reads spec-kit's scan_diff shape", () => {
    const d = normaliseDiff({ base: "abc123", count: 2, additions: 5, deletions: 1, files: [{ path: "src/a.js", add: 4, del: 1, status: "M" }, { path: "b.js", add: 1, del: 0, status: "A" }] })
    expect(d.patch).toBe("full")
    expect(d.base).toBe("abc123")
    expect(d.files).toEqual([
      { file: "src/a.js", add: 4, del: 1, binary: false, status: "M" },
      { file: "b.js", add: 1, del: 0, binary: false, status: "A" },
    ])
  })

  it("reads a numstat listing that serves patches per file", () => {
    const d = normaliseDiff({ repo: "/w/app", base: "b1", branch: "run/x", files: [{ file: "a.png", add: 0, del: 0, binary: true }, { file: "x.kt", add: 3, del: 2, binary: false }] })
    expect(d.patch).toBe("file")
    expect(d.branch).toBe("run/x")
    expect(d.files[0]).toMatchObject({ file: "a.png", binary: true })
  })

  it("carries a files.error and tolerates junk", () => {
    expect(normaliseDiff({ files: { error: "no diff: bad ref" }, repo: "/w" })).toMatchObject({ files: [], patch: "none", error: "no diff: bad ref" })
    expect(normaliseDiff(null)).toEqual({ files: [], patch: "none" })
    expect(normaliseDiff({ files: [{ add: 1 }, null] }).files).toEqual([])
  })
})

describe("splitPatch", () => {
  const text = "diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n-x\n+y\ndiff --git a/b.js b/b.js\nnew file\n+z"
  it("cuts one file's block out of the whole diff", () => {
    expect(splitPatch(text, "b.js")).toBe("diff --git a/b.js b/b.js\nnew file\n+z")
    expect(splitPatch(text, "a.js")).toContain("+y")
    expect(splitPatch(text, "a.js")).not.toContain("+z")
    expect(splitPatch(text, "c.js")).toBe("")
  })
})

describe("normaliseTasks", () => {
  it("takes either an array of rows or {items}", () => {
    expect(normaliseTasks([{ id: "T1", lane: "backend", done: true, text: "x" }])).toEqual([{ id: "T1", lane: "backend", done: true, text: "x" }])
    expect(normaliseTasks({ done: 1, total: 2, items: [{ done: true, text: "a" }, { done: false, text: "b" }] })).toEqual([
      { done: true, text: "a" },
      { done: false, text: "b" },
    ])
    expect(normaliseTasks(undefined)).toEqual([])
  })
})

describe("qa and tabs", () => {
  const qa = { type: "qa", rows: [{ id: "A1", status: "pass", evidence: "ok" }] }
  it("uses the latest qa report", () => {
    expect(qaRows([qa, { type: "qa", rows: [] }])).toEqual([])
    expect(qaRows([{ type: "run.start" }])).toBeNull()
    expect(qaRows([qa])).toEqual([{ id: "A1", status: "pass", evidence: "ok" }])
  })
  it("shows a tab only when its extra is listed; qa also when events carry it", () => {
    expect(extraTabs([], [])).toEqual({ board: false, qa: false, diff: false, docs: false })
    expect(extraTabs([], [qa]).qa).toBe(true)
    expect(extraTabs(["tasks", "diff", "doc"], [])).toEqual({ board: true, qa: false, diff: true, docs: true })
  })
})
