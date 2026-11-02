// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ItemDetail, Lane, Status } from "@/lib/api"
import { FlowStrip } from "./FlowStrip"

afterEach(cleanup)

const lane = (id: string, status: Status, o: Partial<Lane> = {}): Lane => ({ id, label: id, kind: "stage", status, calls: 0, errors: 0, tokens: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }, cost: 0, ...o })
const run: ItemDetail = {
  summary: { source: "demo", id: "r1", kind: "run", title: "t", harness: "h", cwd: null, branch: null, live: true, status: "working", waiting: false, startedAt: null, updatedAt: null, counts: { lanes: 3, calls: 0, errors: 0 }, tokens: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }, cost: 0 },
  lanes: [lane("setup", "done"), lane("backend", "working"), lane("qa", "idle")],
  events: [{ type: "issue", id: "X3", stage: "qa", decision: { owner: "backend", blocks: true }, ts: "2026-01-01T10:00:00Z" }],
  state: { graph: { nodes: { prep: { x: 100, y: 280, stages: ["setup"] }, backend: { x: 400, y: 280 }, qa: { x: 700, y: 280 } }, flow: [["prep", "backend"], ["backend", "qa"]] } },
}

describe("FlowStrip", () => {
  it("draws the map small: a node per stage, arrows between them, a pulse on the working one; a click picks its lanes", () => {
    const onPick = vi.fn()
    render(<FlowStrip detail={run} onPick={onPick} />)
    const nodes = [...document.querySelectorAll("[data-flow-node]")].map((n) => n.getAttribute("data-flow-node"))
    expect(nodes).toEqual(["prep", "backend", "qa"])
    expect(document.querySelectorAll("[data-flow-link]").length).toBe(2)
    expect(document.querySelector('[data-flow-node="backend"] .mc-halo')).toBeTruthy()
    expect(document.querySelector('[data-flow-node="qa"] .mc-halo')).toBeNull()
    expect(document.querySelector('[data-flow-arc="sendback"]')).toBeTruthy()
    fireEvent.click(document.querySelector('[data-flow-node="prep"]')!)
    expect(onPick).toHaveBeenCalledWith(["setup"])
  })
  it("a session with many sub-agents shows the busiest few and counts the rest", () => {
    const lanes = [lane("main", "working", { kind: "main" }), ...Array.from({ length: 30 }, (_, i) => lane(`s${i}`, i === 7 ? "working" : "done", { kind: "subagent", parent: "main" }))]
    render(<FlowStrip detail={{ ...run, state: undefined, events: [], lanes, summary: { ...run.summary, kind: "session" } }} onPick={() => {}} />)
    const shown = document.querySelectorAll("[data-flow-node]")
    expect(shown.length).toBeLessThanOrEqual(13)
    expect(document.querySelector('[data-flow-node="s7"]')).toBeTruthy()
    expect(document.body.textContent).toMatch(/\+\d+ more/)
  })
  it("nothing to draw for an item with no lanes", () => {
    const { container } = render(<FlowStrip detail={{ ...run, state: undefined, events: [], lanes: [] }} onPick={() => {}} />)
    expect(container.innerHTML).toBe("")
  })
})
