// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Call } from "@/lib/api"
import { CallList, chipCounts, filterCalls, fmtDuration, moveIndex, optionId, windowRange } from "./CallList"

afterEach(cleanup)

const mk = (n: number, over: Partial<Call> = {}): Call => ({
  id: `c${n}`, lane: "main", ts: `2026-01-01T10:00:${String(n % 60).padStart(2, "0")}.000Z`, name: "Read", kind: "tool", summary: `file-${n}.md`, ok: true, ...over,
})

const calls: Call[] = [
  mk(1),
  mk(2, { name: "Bash", summary: "npm test", ok: false, error: "exit 1" }),
  mk(3, { kind: "mcp", server: "browser", name: "navigate", summary: "open the settings page" }),
  mk(4, { kind: "mcp", server: "browser", name: "click", summary: "Continue", lane: "agent-a", ok: false, error: "no element" }),
  mk(5, { kind: "skill", name: "verification", summary: "verification", lane: "agent-a" }),
  mk(6, { kind: "agent", name: "Agent", summary: "Review the parser", subLane: "agent-a" }),
  mk(7, { lane: "agent-a", summary: "README.md", ok: undefined }),
]

describe("chip counts", () => {
  it("counts every kind and errors over the given calls", () => {
    expect(chipCounts(calls)).toEqual({ all: 7, tool: 3, mcp: 2, skill: 1, agent: 1, errors: 2 })
  })
  it("counts follow the lane and the search, not the chip", () => {
    const lane = filterCalls(calls, { lane: "agent-a", chip: "all", q: "" })
    expect(chipCounts(lane)).toEqual({ all: 3, tool: 1, mcp: 1, skill: 1, agent: 0, errors: 1 })
    const searched = filterCalls(calls, { lane: null, chip: "all", q: "BROWSER" })
    expect(searched.map((c) => c.id)).toEqual(["c3", "c4"]) // the MCP server name is searched too
    expect(chipCounts(filterCalls(calls, { lane: null, chip: "all", q: "continue" }))).toMatchObject({ all: 1, mcp: 1, errors: 1 })
  })
})

describe("filterCalls", () => {
  it("chip narrows by kind; Errors keeps failed calls only", () => {
    expect(filterCalls(calls, { lane: null, chip: "mcp", q: "" }).map((c) => c.id)).toEqual(["c3", "c4"])
    expect(filterCalls(calls, { lane: null, chip: "errors", q: "" }).map((c) => c.id)).toEqual(["c2", "c4"])
  })
  it("search matches name or summary, case-insensitive, combined with lane and chip", () => {
    expect(filterCalls(calls, { lane: null, chip: "all", q: "bash" }).map((c) => c.id)).toEqual(["c2"])
    expect(filterCalls(calls, { lane: null, chip: "all", q: "md" }).map((c) => c.id)).toEqual(["c1", "c7"])
    expect(filterCalls(calls, { lane: "agent-a", chip: "tool", q: "readme" }).map((c) => c.id)).toEqual(["c7"])
    expect(filterCalls(calls, { lane: "main", chip: "all", q: "  " })).toHaveLength(4)
  })
})

describe("formatting and windowing", () => {
  it("durations", () => {
    expect(fmtDuration(undefined)).toBe("—")
    expect(fmtDuration(80)).toBe("0.1s")
    expect(fmtDuration(1234)).toBe("1.2s")
    expect(fmtDuration(48_000)).toBe("48s")
    expect(fmtDuration(125_000)).toBe("2m 5s")
  })
  it("windowRange renders only the visible rows plus overscan", () => {
    expect(windowRange({ count: 2000, rowHeight: 36, scrollTop: 0, height: 360, overscan: 10 })).toEqual({ start: 0, end: 20 })
    expect(windowRange({ count: 2000, rowHeight: 36, scrollTop: 3600, height: 360, overscan: 10 })).toEqual({ start: 90, end: 120 })
    expect(windowRange({ count: 50, rowHeight: 36, scrollTop: 3600, height: 360, overscan: 10 })).toEqual({ start: 30, end: 50 })
  })
})

describe("CallList", () => {
  const many = Array.from({ length: 1200 }, (_, i) => mk(i))
  it("renders every row up to 500 calls", () => {
    render(<CallList calls={many.slice(0, 500)} selectedId={null} onSelect={() => {}} />)
    expect(screen.getAllByRole("option")).toHaveLength(500)
  })
  it("windows the list beyond 500 calls", () => {
    render(<CallList calls={many} selectedId={null} onSelect={() => {}} />)
    const rows = screen.getAllByRole("option")
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThan(100)
    expect(rows[0].getAttribute("aria-setsize")).toBe("1200")
  })
  it("selects a call on click and marks it", () => {
    const onSelect = vi.fn()
    const { rerender } = render(<CallList calls={calls} selectedId={null} onSelect={onSelect} />)
    fireEvent.click(screen.getByText("npm test"))
    expect(onSelect).toHaveBeenCalledWith("c2")
    rerender(<CallList calls={calls} selectedId="c2" onSelect={onSelect} />)
    expect(screen.getByText("npm test").closest("[role=option]")?.getAttribute("aria-selected")).toBe("true")
  })
  it("a long MCP server name truncates, the tool name stays whole outside the truncating part", () => {
    const long = mk(9, { kind: "mcp", server: "plugin_some-very-long_mcp-server-name", name: "work_state_write" })
    render(<CallList calls={[long]} selectedId={null} onSelect={() => {}} />)
    const tool = screen.getByText("· work_state_write")
    expect(tool.closest(".truncate")).toBeNull()
    expect(tool.className).toContain("shrink-0")
    const server = screen.getByText("plugin_some-very-long_mcp-server-name")
    expect(server.className).toContain("truncate")
  })
  it("shows an empty state", () => {
    render(<CallList calls={[]} selectedId={null} onSelect={() => {}} empty="No calls match." />)
    expect(screen.getByText("No calls match.")).toBeTruthy()
  })
})

describe("call list keyboard (listbox with aria-activedescendant)", () => {
  it("moveIndex: arrows clamp at the ends, Home/End jump, other keys do nothing", () => {
    expect(moveIndex("ArrowDown", -1, 3)).toBe(0)
    expect(moveIndex("ArrowDown", 2, 3)).toBe(2)
    expect(moveIndex("ArrowUp", 0, 3)).toBe(0)
    expect(moveIndex("Home", 2, 3)).toBe(0)
    expect(moveIndex("End", 0, 3)).toBe(2)
    expect(moveIndex("a", 0, 3)).toBeNull()
    expect(moveIndex("ArrowDown", -1, 0)).toBeNull()
  })
  it("the list takes focus; arrows move the active row, Enter opens it", () => {
    const onSelect = vi.fn()
    render(<CallList calls={calls} selectedId={null} onSelect={onSelect} />)
    const box = screen.getByRole("listbox")
    expect(box.tabIndex).toBe(0)
    fireEvent.focus(box)
    expect(box.getAttribute("aria-activedescendant")).toBe(optionId("c1"))
    fireEvent.keyDown(box, { key: "ArrowDown" })
    fireEvent.keyDown(box, { key: "ArrowDown" })
    expect(box.getAttribute("aria-activedescendant")).toBe(optionId("c3"))
    expect(document.getElementById(optionId("c3"))?.getAttribute("role")).toBe("option")
    fireEvent.keyDown(box, { key: "End" })
    expect(box.getAttribute("aria-activedescendant")).toBe(optionId("c7"))
    fireEvent.keyDown(box, { key: "Home" })
    fireEvent.keyDown(box, { key: "Enter" })
    expect(onSelect).toHaveBeenLastCalledWith("c1")
    expect(onSelect).toHaveBeenCalledTimes(1) // arrows only move; Enter opens
  })
  it("windowed: End renders and scrolls to the last row so the active option exists in the DOM", () => {
    const many = Array.from({ length: 1200 }, (_, i) => mk(i))
    render(<CallList calls={many} selectedId={null} onSelect={() => {}} />)
    const box = screen.getByRole("listbox")
    Object.defineProperty(box, "clientHeight", { value: 600, configurable: true })
    fireEvent.focus(box)
    fireEvent.keyDown(box, { key: "End" })
    const id = box.getAttribute("aria-activedescendant")!
    expect(id).toBe(optionId("c1199"))
    expect(document.getElementById(id)).toBeTruthy()
    expect(box.scrollTop).toBeGreaterThan(40000)
  })
})
