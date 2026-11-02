// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Lane, Status } from "@/lib/api"
import type { LaneExtra } from "@/lib/item"
import { LaneCards } from "./LaneCards"

afterEach(cleanup)

const NOW = Date.parse("2026-01-01T10:10:00Z")
const lane = (id: string, status: Status, o: Partial<Lane> = {}): Lane => ({ id, label: id, kind: "stage", status, calls: 2, errors: 0, tokens: { in: 1000, out: 0, cacheRead: 0, cacheWrite: 0 }, cost: 0.31, ...o })
const card = (id: string) => document.querySelector(`[data-lane="${id}"]`) as HTMLElement

describe("LaneCards", () => {
  it("one card per lane state; a non-owner stop reads stopped, never failed", () => {
    const extras = new Map<string, LaneExtra>([
      ["backend", { rounds: 3, chip: { kind: "sendback", text: "fix X3 · from qa" }, skipped: false }],
      ["frontend", { rounds: 1, chip: { kind: "stopped", text: "3 rounds (limit 3)" }, skipped: false }],
    ])
    render(
      <LaneCards
        now={NOW}
        extras={extras}
        lanes={[
          lane("backend", "working", { nowDoing: { name: "Edit", kind: "tool", summary: "src/tip.mjs", ts: "2026-01-01T10:09:48Z" }, model: "claude-sonnet-4-5" }),
          lane("qa", "waiting", { reason: "approve Q4" }),
          lane("build", "failed", { errors: 1 }),
          lane("frontend", "stopped", { reason: "3 rounds (limit 3)" }),
          lane("review", "idle", { calls: 0 }),
        ]}
      />,
    )
    expect(card("backend").textContent).toContain("round 3")
    expect(card("backend").textContent).toContain("Edit")
    expect(card("backend").textContent).toContain("12s ago · sonnet")
    expect(card("backend").textContent).toContain("fix X3 · from qa")
    expect(card("backend").textContent).toContain("$0.31 est.")
    expect(card("backend").querySelector(".mc-pulse")).toBeTruthy()
    expect(card("qa").textContent).toContain("waiting on you")
    expect(card("build").textContent).toContain("failed")
    expect(card("frontend").dataset.status).toBe("stopped")
    expect(card("frontend").textContent).toContain("stopped")
    expect(card("frontend").textContent).not.toContain("failed")
    expect(card("frontend").className).not.toMatch(/border-failed/)
    expect(card("review").textContent).toContain("queued")
    expect(card("review").querySelector(".mc-pulse")).toBeNull()
  })

  it("a run's done and skipped stages fold into the Done line", () => {
    const extras = new Map<string, LaneExtra>([["design", { rounds: 0, chip: null, skipped: true }]])
    render(<LaneCards now={NOW} extras={extras} lanes={[lane("prep", "done"), lane("design", "idle"), lane("qa", "working")]} />)
    const done = screen.getByLabelText("Done")
    expect(done.textContent).toContain("prep")
    expect(done.textContent).toContain("design skipped")
    expect(card("qa")).toBeTruthy()
  })

  it("subagents nest under their parent with a count; quiet ones as rows", () => {
    const onOpen = vi.fn()
    render(
      <LaneCards
        now={NOW}
        extras={new Map()}
        onOpen={onOpen}
        lanes={[lane("main", "working", { kind: "main" }), lane("agent-a", "working", { kind: "subagent", parent: "main", label: "Implement Task 1" }), lane("agent-b", "done", { kind: "subagent", parent: "main", label: "Review Task 1" })]}
      />,
    )
    const group = screen.getByLabelText("main and its subagents")
    expect(group.textContent).toContain("Subagents · 2")
    expect(group.textContent).toContain("1 busy")
    expect(group.textContent).toContain("1 finished or idle")
    fireEvent.click(screen.getByText("Review Task 1"))
    expect(onOpen).toHaveBeenCalledWith("agent-b")
  })

  it("an item with no lanes shows an empty state", () => {
    render(<LaneCards now={NOW} extras={new Map()} lanes={[]} />)
    expect(screen.getByText("No lanes recorded for this item.")).toBeTruthy()
  })
})
