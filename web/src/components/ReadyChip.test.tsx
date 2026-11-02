// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ItemSummary, Overview, ReadyItem } from "@/lib/api"
import { chipCounts, StatusChips } from "./StatusChips"
import { ReadyList } from "./ReadyList"
import { filterCount, matchesFilter } from "@/lib/tree"

afterEach(cleanup)

const ov = (extra: Partial<Overview["counts"]> = {}): Overview => ({
  counts: { waiting: 1, working: 2, stopped: 0, done: 0, ready: 3, looping: 0, ...extra },
  needsYou: [], ready: [], live: [], hidden: 0,
})
const ready = (id: string): ReadyItem => ({ source: "claude-code", id, title: `task ${id}`, cwd: "/w/app", branch: "main", harness: "claude-code", updatedAt: "2026-11-02T09:00:00Z", since: "2026-11-02T09:59:00Z", project: { key: "app-1", name: "app", worktree: "/w/app" } })

describe("Ready chip", () => {
  it("counts ready sessions from the overview, in the calm info tone (not amber), and filters on click", () => {
    const onPick = vi.fn()
    render(<StatusChips counts={chipCounts(ov(), 0)} active={null} onPick={onPick} />)
    const chip = screen.getByRole("button", { name: /Ready/ })
    expect(chip.textContent).toContain("3")
    expect(chip.className).toContain("text-consult")
    expect(chip.className).not.toContain("needs-you")
    fireEvent.click(chip)
    expect(onPick).toHaveBeenCalledWith("ready")
  })

  it("the ready filter keeps ready items only, and counts them per worktree", () => {
    const base = { source: "s", id: "a", kind: "session", title: "", harness: "", cwd: null, branch: null, live: false, waiting: false, startedAt: null, updatedAt: null, counts: { lanes: 1, calls: 0, errors: 0 }, tokens: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }, cost: 0 } as const
    expect(matchesFilter({ ...base, status: "idle", ready: true } as ItemSummary, "ready")).toBe(true)
    expect(matchesFilter({ ...base, status: "idle" } as ItemSummary, "ready")).toBe(false)
    expect(filterCount({ counts: { items: 4, live: 0, ready: 2, working: 0, waiting: 0, stopped: 0, failed: 0, done: 0, idle: 4, looping: 0 }, doneToday: 0 }, "ready")).toBe(2)
  })
})

describe("ReadyList (Home)", () => {
  it("is collapsed by default, shows the count, and opens to links for each ready session", () => {
    render(<ReadyList entries={[ready("r1"), ready("r2")]} now={Date.parse("2026-11-02T10:00:00Z")} />)
    const summary = screen.getByText(/^Ready/).closest("summary")!
    expect(summary.textContent).toContain("2")
    const details = summary.closest("details")!
    expect(details.open).toBe(false)
    fireEvent.click(summary)
    expect(details.open).toBe(true)
    expect(screen.getByRole("link", { name: "task r1" }).getAttribute("href")).toContain("claude-code")
    expect(details.textContent).toContain("ready 1m")
  })

  it("renders nothing when no session is ready", () => {
    const { container } = render(<ReadyList entries={[]} now={0} />)
    expect(container.textContent).toBe("")
  })
})
