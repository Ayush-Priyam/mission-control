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

  it("hovering a card outlines the cards it is linked to, with what passed between them", () => {
    const links = [
      { from: "qa", to: "backend", kind: "sendback" as const, labels: ["X3"] },
      { from: "backend", to: "architect", kind: "consult" as const, labels: ["Q4"] },
    ]
    render(<LaneCards now={NOW} extras={new Map()} links={links} lanes={[lane("backend", "working"), lane("qa", "waiting"), lane("architect", "working"), lane("review", "idle")]} />)
    fireEvent.mouseEnter(card("backend"))
    expect(card("qa").dataset.linked).toBe("sendback")
    expect(card("qa").textContent).toContain("sent back X3 to backend")
    expect(card("architect").dataset.linked).toBe("consult")
    expect(card("architect").textContent).toContain("asked Q4 by backend")
    expect(card("review").dataset.linked).toBeUndefined()
    fireEvent.mouseEnter(card("qa"))
    expect(card("backend").textContent).toContain("got X3 back from qa")
    fireEvent.mouseLeave(card("qa"))
    expect(card("backend").dataset.linked).toBeUndefined()
  })

  it("lanes working at the same time share one row labelled running in parallel", () => {
    render(<LaneCards now={NOW} extras={new Map()} lanes={[lane("backend", "working"), lane("frontend", "working"), lane("qa", "waiting"), lane("review", "idle")]} />)
    const row = screen.getByLabelText("running in parallel · 2")
    expect(row.textContent).toContain("running in parallel · 2")
    expect(row.querySelector('[data-lane="backend"]')).toBeTruthy()
    expect(row.querySelector('[data-lane="frontend"]')).toBeTruthy()
    expect(row.querySelector('[data-lane="qa"]')).toBeNull()
  })

  it("a focus request scrolls to the lane's card and flashes it, opening a folded group if needed", () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    const lanes = [lane("main", "working", { kind: "main" }), ...Array.from({ length: 14 }, (_, i) => lane(`q${i}`, "done", { kind: "subagent", parent: "main" }))]
    const { rerender } = render(<LaneCards now={NOW} extras={new Map()} lanes={lanes} />)
    expect(card("q3")).toBeNull()
    rerender(<LaneCards now={NOW} extras={new Map()} lanes={lanes} focus={{ ids: ["q3"], n: 1 }} />)
    expect(card("q3")).toBeTruthy()
    expect(card("q3").className).toContain("mc-flash")
    expect(scroll).toHaveBeenCalled()
  })
})

