// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ItemDetail, Lane, Status } from "@/lib/api"
import { FlowStrip } from "./FlowStrip"

afterEach(() => {
  cleanup()
  localStorage.clear()
})

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
  it("hovering a lane card lights its node (a band node for a banded lane) and the links and arcs touching it", () => {
    const { rerender } = render(<FlowStrip detail={run} onPick={() => {}} highlight={null} />)
    expect(document.querySelectorAll("[data-hl]").length).toBe(0)
    rerender(<FlowStrip detail={run} onPick={() => {}} highlight="setup" />) // carried by the "prep" node
    expect(document.querySelector('[data-flow-node="prep"]')!.hasAttribute("data-hl")).toBe(true)
    expect([...document.querySelectorAll("[data-flow-link][data-hl]")].length).toBe(1)
    rerender(<FlowStrip detail={run} onPick={() => {}} highlight="qa" />)
    expect(document.querySelector('[data-flow-node="qa"]')!.hasAttribute("data-hl")).toBe(true)
    expect(document.querySelector('[data-flow-arc="sendback"]')!.hasAttribute("data-hl")).toBe(true)
    expect(document.querySelector('[data-flow-node="prep"]')!.hasAttribute("data-hl")).toBe(false)
  })
  it("nothing to draw for an item with no lanes", () => {
    const { container } = render(<FlowStrip detail={{ ...run, state: undefined, events: [], lanes: [] }} onPick={() => {}} />)
    expect(container.innerHTML).toBe("")
  })

  const big = () => {
    const lanes = [
      lane("main", "working", { kind: "main", model: "claude-opus-4-1" }),
      ...Array.from({ length: 30 }, (_, i) => lane(`s${i}`, "done", { kind: "subagent", parent: "main", label: `Re-review findings for part ${i} of the plan`, model: "claude-sonnet-4-5" })),
    ]
    return { ...run, state: undefined, events: [], lanes, summary: { ...run.summary, kind: "session" as const } }
  }
  it("+N more is a button: it expands the strip in place to every lane, remembered per tab, and collapses again", () => {
    render(<FlowStrip detail={big()} onPick={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /\+18 more/ }))
    expect(document.querySelectorAll("[data-flow-node]").length).toBe(31)
    expect(localStorage.getItem("mission-control-flow-expanded:lanes")).toBe("expanded")
    cleanup()
    render(<FlowStrip detail={big()} onPick={() => {}} />)
    expect(document.querySelectorAll("[data-flow-node]").length).toBe(31) // remembered
    fireEvent.click(screen.getByRole("button", { name: "Collapse" }))
    expect(document.querySelectorAll("[data-flow-node]").length).toBe(13)
    expect(localStorage.getItem("mission-control-flow-expanded:lanes")).toBe("collapsed")
  })
  it("nodes grow to their labels up to 220px; focus shows the full label, status and model", () => {
    render(<FlowStrip detail={big()} onPick={() => {}} />)
    const node = document.querySelector('[data-flow-node="s0"]')!
    expect(Number(node.querySelector("rect.box")!.getAttribute("width"))).toBe(220)
    fireEvent.focus(node)
    expect(screen.getByRole("tooltip").textContent).toBe("Re-review findings for part 0 of the plan · done · sonnet")
  })
  it("Expand opens the graph full screen with full labels; a node click closes it and picks; Esc closes and returns focus", () => {
    const onPick = vi.fn()
    render(<FlowStrip detail={big()} onPick={onPick} />)
    const open = screen.getByRole("button", { name: "Expand to full screen" })
    open.focus()
    fireEvent.click(open)
    const dlg = screen.getByRole("dialog")
    expect(dlg.getAttribute("aria-modal")).toBe("true")
    expect(dlg.querySelectorAll("[data-flow-node]").length).toBe(31)
    expect(dlg.textContent).toContain("Re-review findings for part 29 of the plan") // not truncated
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close full screen" }))
    fireEvent.keyDown(window, { key: "Escape" })
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(document.activeElement).toBe(open)
    fireEvent.click(open)
    fireEvent.click(screen.getByRole("dialog").querySelector('[data-flow-node="s3"]')!)
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(onPick).toHaveBeenCalledWith(["s3"])
  })
})
