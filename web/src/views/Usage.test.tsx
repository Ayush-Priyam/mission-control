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

type Reply = { ok: boolean; status?: number; json: () => Promise<object> }
const isWeek = (url: URL) => {
  const from = url.searchParams.get("from"), to = url.searchParams.get("to")
  return !!from && !!to && (Date.parse(to) - Date.parse(from)) / 86_400_000 === 6
}
const withSpan = (url: URL, o: object) => ({ ...o, from: url.searchParams.get("from"), to: url.searchParams.get("to") })

function stub(make: (by: string, url: URL) => object, override?: (url: URL) => Promise<Reply> | null) {
  const fetch = vi.fn(async (u: string): Promise<Reply> => {
    const url = new URL(u, "http://x")
    const o = override?.(url)
    if (o) return o
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

  const full = (by: string, url: URL) =>
    withSpan(url, answer(by, { totals: { ...tok(1000), cost: 2, sessions: 1 }, series: [{ day: "2026-10-30", ...tok(1000), cost: 2, sessions: 1, byKey: {} }], groups: [{ key: by === "harness" ? "claude-code" : "model-x", ...tok(1000), cost: 2, sessions: 1 }] }))

  it("while a new range loads, the last answer is dimmed and busy and keeps its own dates, not the new range's label", async () => {
    stub(full, (url) => (isWeek(url) ? new Promise<Reply>(() => {}) : null))
    render(<Usage />)
    await waitFor(() => expect(screen.getByTestId("usage-total").textContent).toBe("1,000"))
    const monthSpan = screen.getByLabelText("Usage totals").querySelector("h2")!.textContent!
    expect(monthSpan).toMatch(/LAST 30 DAYS/)
    fireEvent.click(screen.getByRole("tab", { name: "Week" }))
    await waitFor(() => expect(screen.getByLabelText("Totals").getAttribute("aria-busy")).toBe("true"))
    const label = screen.getByLabelText("Usage totals").querySelector("h2")!.textContent!
    expect(label).not.toMatch(/LAST 7 DAYS|LAST 30 DAYS/)
    expect(label).toMatch(/\d{4}-\d{2}-\d{2} → \d{4}-\d{2}-\d{2}/)
    expect(screen.getByText("loading…")).toBeTruthy()
    expect(screen.queryByText("No harness reported usage in this range.")).toBeNull()
  })

  it("a failure after a successful load is shown, with the last answer kept", async () => {
    stub(full, (url) => (isWeek(url) ? Promise.resolve({ ok: false, status: 500, json: async () => ({ error: "scan exploded" }) }) : null))
    render(<Usage />)
    await waitFor(() => expect(screen.getByTestId("usage-total").textContent).toBe("1,000"))
    fireEvent.click(screen.getByRole("tab", { name: "Week" }))
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toMatch(/scan exploded/)
    expect(alert.textContent).toMatch(/showing the last answer/)
    expect(screen.getByTestId("usage-total").textContent).toBe("1,000")
  })

  it("every cost says it is an estimate at API list prices", async () => {
    stub(full)
    render(<Usage />)
    await waitFor(() => expect(screen.getByTestId("usage-total").textContent).toBe("1,000"))
    expect(screen.getByText(/est\. · API prices/)).toBeTruthy()
    const th = screen.getByText("Est. cost").closest("th")!
    expect(th.getAttribute("title")).toBe("API list prices; subscription plans differ")
    expect(screen.getByText("$2.00 est.")).toBeTruthy() // harness card
  })

  it("main fresh but harness still loading: the harness section keeps its own old span, never the new range's", async () => {
    stub(full, (url) => (isWeek(url) && url.searchParams.get("by") === "harness" ? new Promise<Reply>(() => {}) : null))
    render(<Usage />)
    await waitFor(() => expect(screen.getByTestId("usage-total").textContent).toBe("1,000"))
    fireEvent.click(screen.getByRole("tab", { name: "Week" }))
    await waitFor(() => expect(screen.getByLabelText("Harnesses").getAttribute("aria-busy")).toBe("true"))
    expect(screen.getByLabelText("Totals").getAttribute("aria-busy")).toBeNull()
    expect(screen.getByLabelText("Usage totals").querySelector("h2")!.textContent).toMatch(/LAST 7 DAYS/)
    const h = screen.getByLabelText("Harnesses").textContent!
    expect(h).toMatch(/\d{4}-\d{2}-\d{2} → \d{4}-\d{2}-\d{2} · loading…/)
    const monthFrom = new URL(String(vi.mocked(fetch).mock.calls[0][0]), "http://x").searchParams.get("from")!
    expect(h).toContain(monthFrom)
    fireEvent.click(screen.getByRole("tab", { name: "harness" }))
    expect(screen.getByLabelText("Split").getAttribute("aria-busy")).toBe("true")
    expect(screen.getByLabelText("Split").textContent).toContain(monthFrom)
  })

  it("switching breakdown tabs never shows the previous tab's rows under the new header", async () => {
    stub(
      (by, url) => (by === "project" ? withSpan(url, answer(by, { groups: [{ key: "p1", name: "proj-alpha", ...tok(9), cost: 1, sessions: 1 }] })) : full(by, url)),
      (url) => (url.searchParams.get("by") === "branch" ? new Promise<Reply>(() => {}) : null),
    )
    render(<Usage />)
    await waitFor(() => expect(screen.getByTestId("usage-total").textContent).toBe("1,000"))
    fireEvent.click(screen.getByRole("tab", { name: "Projects" }))
    await screen.findByText("proj-alpha")
    fireEvent.click(screen.getByRole("tab", { name: "Branches" }))
    await waitFor(() => expect(screen.queryByText("proj-alpha")).toBeNull())
    expect(screen.queryByText("Project")).toBeNull()
  })
})

describe("Heatmap labels", () => {
  it("month and weekday labels are real 10px text, not scaled SVG", async () => {
    stub((by) => answer(by))
    render(<Usage />)
    const map = await screen.findByLabelText("Activity heatmap")
    const labels = map.querySelectorAll("[data-heat-label]")
    expect(labels.length).toBeGreaterThan(7)
    labels.forEach((l) => expect(l.className).toContain("text-[10px]"))
    expect(map.querySelector("svg")).toBeNull()
  })
})
