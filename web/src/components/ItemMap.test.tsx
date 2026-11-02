// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ItemDetail, Lane, Status } from "@/lib/api"
import { ItemMap } from "./ItemMap"

afterEach(cleanup)

const T = (m: number) => new Date(Date.now() - (20 - m) * 60000).toISOString()
const lane = (id: string, status: Status): Lane => ({ id, label: id, kind: "stage", status, calls: 0, errors: 0, tokens: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }, cost: 0 })
const detail: ItemDetail = {
  summary: { source: "demo", id: "r1", kind: "run", title: "t", harness: "h", cwd: null, branch: null, live: true, status: "working", waiting: true, startedAt: T(0), updatedAt: T(10), counts: { lanes: 4, calls: 0, errors: 0 }, tokens: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }, cost: 0 },
  lanes: [lane("backend", "working"), lane("frontend", "working"), lane("qa", "waiting"), lane("review", "idle")],
  events: [
    { type: "issue", id: "X3", stage: "qa", decision: { owner: "backend", blocks: true }, ts: T(6) },
    { type: "stage.start", stage: "backend", ts: T(7) },
    { type: "stage.start", stage: "frontend", ts: T(8) },
    { type: "stop", stage: "qa", rule: "human", ts: T(10) },
  ],
  state: { graph: { nodes: { backend: { x: 300, y: 380 }, frontend: { x: 300, y: 190 }, qa: { x: 600, y: 280 }, review: { x: 800, y: 280 } }, flow: [["backend", "qa"], ["frontend", "qa"], ["qa", "review"]] } },
}

describe("ItemMap", () => {
  it("labels hops on a chip, bands the lanes working together, and the you node opens the needs-you card", () => {
    const onYou = vi.fn()
    render(<ItemMap detail={detail} extras={new Map()} onOpen={() => {}} onYou={onYou} />)
    const chip = document.querySelector('[data-arc="sendback"] [data-chip]')
    expect(chip?.querySelector("rect")).toBeTruthy()
    expect(chip?.textContent).toContain("X3")
    expect(document.querySelector("[data-band]")?.textContent).toBe("parallel · 2")
    expect(document.querySelector('[data-you-edge="waiting"]')).toBeTruthy()
    fireEvent.click(document.querySelector('[data-node="you"]')!)
    expect(onYou).toHaveBeenCalledOnce()
  })
  it("the drawing fits the panel height (letterboxed, centred)", () => {
    render(<ItemMap detail={detail} extras={new Map()} onOpen={() => {}} />)
    const svg = document.querySelector("svg[aria-label='Crew map']") as SVGElement
    expect(svg.style.maxHeight).not.toBe("")
    expect(svg.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet")
  })

  it("fullLabels draws every node label whole (the full-screen map)", () => {
    const long = "Re-review the findings for part 7 of the implementation plan"
    const session: ItemDetail = { ...detail, state: undefined, events: [], summary: { ...detail.summary, kind: "session" }, lanes: [{ ...lane("main", "working"), kind: "main" }, { ...lane("k1", "done"), kind: "subagent", parent: "main", label: long }] }
    render(<ItemMap natural fullLabels detail={session} extras={new Map()} onOpen={() => {}} />)
    expect(document.querySelector('[data-node="k1"] text')?.textContent).toBe(long)
    cleanup()
    render(<ItemMap detail={session} extras={new Map()} onOpen={() => {}} />)
    expect(document.querySelector('[data-node="k1"] text')?.textContent).toMatch(/…$/)
  })
})
