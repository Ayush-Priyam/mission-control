// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Usage } from "./Usage"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const tok = (n: number) => ({ in: n, out: 0, cacheRead: 0, cacheWrite: 0 })
const answer = (by: string, over: object = {}) => ({
  totals: { ...tok(0), cost: 0, sessions: 0 }, series: [], groups: [], by, tz: "UTC", from: null, to: null, complete: true, ...over,
})

function stub(make: (by: string, url: URL) => object) {
  const fetch = vi.fn(async (u: string) => {
    const url = new URL(u, "http://x")
    return { ok: true, json: async () => make(url.searchParams.get("by")!, url) }
  })
  vi.stubGlobal("fetch", fetch)
  return fetch
}

describe("Usage page", () => {
  it("renders empty states when no source reported usage", async () => {
    stub((by) => answer(by))
    render(<Usage />)
    await waitFor(() => expect(screen.getByTestId("usage-total").textContent).toBe("0"))
    expect(screen.getByText("No usage in this range.")).toBeTruthy()
    expect(screen.getByText("No harness reported usage in this range.")).toBeTruthy()
    expect(screen.getByLabelText("Activity heatmap")).toBeTruthy()
  })

  it("sends the browser zone, shows the total, and loads a grouped table only when its tab is opened", async () => {
    const fetch = stub((by) =>
      by === "worktree"
        ? answer(by, { groups: [{ key: "/work/repo-a", ...tok(5), cost: 1, sessions: 1 }] })
        : answer(by, { totals: { ...tok(1234567), cost: 12.5, sessions: 3 }, groups: [{ key: by === "harness" ? "claude-code" : "model-x", ...tok(1234567), cost: 12.5, sessions: 3 }] }),
    )
    render(<Usage />)
    await waitFor(() => expect(screen.getByTestId("usage-total").textContent).toBe("1,234,567"))
    expect(screen.getByText("$12.50")).toBeTruthy()
    const urls = fetch.mock.calls.map(([u]) => new URL(u, "http://x"))
    expect(urls.every((u) => u.searchParams.get("tz") === Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(true)
    expect(urls.some((u) => u.searchParams.get("by") === "worktree")).toBe(false)
    fireEvent.click(screen.getByRole("tab", { name: "Worktrees" }))
    await waitFor(() => expect(screen.getByText("repo-a")).toBeTruthy())
    expect(screen.getByText("/work/repo-a")).toBeTruthy()
  })

  it("Week asks for the last 7 days", async () => {
    const fetch = stub((by) => answer(by))
    render(<Usage />)
    fireEvent.click(await screen.findByRole("tab", { name: "Week" }))
    await waitFor(() => {
      const u = new URL(fetch.mock.calls.at(-1)![0], "http://x")
      const from = u.searchParams.get("from")!, to = u.searchParams.get("to")!
      expect((Date.parse(to) - Date.parse(from)) / 86_400_000).toBe(6)
    })
  })
})
