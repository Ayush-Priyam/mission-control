// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import DiffView from "./Diff"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const serve = (routes: Record<string, unknown>) =>
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const hit = Object.entries(routes).find(([k]) => url.includes(k))
    return hit ? { ok: true, json: async () => hit[1] } : { ok: false, status: 404, json: async () => ({}) }
  }))

describe("DiffView", () => {
  it("shows a spec-kit listing and cuts the file out of the whole-diff text", async () => {
    serve({
      "full=1": { text: "diff --git a/a.js b/a.js\n@@ -1 +1 @@\n-old\n+new\ndiff --git a/b.js b/b.js\n+other" },
      "/api/x/diff/r1": { base: "abc", count: 1, additions: 1, deletions: 1, files: [{ path: "a.js", add: 1, del: 1, status: "M" }] },
    })
    render(<DiffView runId="r1" />)
    await waitFor(() => expect(screen.getByText("+new")).toBeTruthy())
    expect(screen.queryByText("+other")).toBeNull()
  })

  it("asks a numstat adapter for the file's own patch", async () => {
    serve({
      "file=x.kt": { patch: "diff --git a/x.kt b/x.kt\n@@ -1 +1 @@\n-a\n+b", lines: 4 },
      "/api/x/diff/r2": { repo: "/w", base: "b1", branch: "run/x", files: [{ file: "x.kt", add: 1, del: 1, binary: false }] },
    })
    render(<DiffView runId="r2" />)
    await waitFor(() => expect(screen.getByText("+b")).toBeTruthy())
  })
})
