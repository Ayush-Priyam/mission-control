// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { SameFileWarnings } from "./SameFileWarnings"

afterEach(cleanup)
const w = {
  path: "src/api.ts", gapMs: 240000, text: "shop in feat/search and main both edited src/api.ts 4m apart",
  a: { source: "claude-code", id: "b1", title: "search", branch: "feat/search", worktree: "/wt/search", ts: "2026-11-02T11:58:00Z" },
  b: { source: "codex", id: "a1", title: "fix", branch: "main", worktree: "/repo", ts: "2026-11-02T11:54:00Z" },
}

describe("SameFileWarnings", () => {
  it("renders nothing without warnings", () => {
    const { container } = render(<SameFileWarnings warnings={[]} />)
    expect(container.innerHTML).toBe("")
  })
  it("on an item, links to the other side", () => {
    render(<SameFileWarnings warnings={[w]} self={{ source: "claude-code", id: "b1" }} />)
    expect(screen.getByRole("alert").textContent).toContain("both edited src/api.ts 4m apart")
    expect(screen.getByText("main").getAttribute("href")).toBe("#/item/codex/a1/calls")
  })
  it("on the project, links to both", () => {
    render(<SameFileWarnings warnings={[w]} />)
    expect(screen.getByText("feat/search").getAttribute("href")).toBe("#/item/claude-code/b1/calls")
    expect(screen.getByText("main").getAttribute("href")).toBe("#/item/codex/a1/calls")
  })
})
