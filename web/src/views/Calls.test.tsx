// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import Calls from "./Calls"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const lanes = [
  { id: "main", label: "main", kind: "main", status: "idle", calls: 4, errors: 1 },
  { id: "agent-a", label: "Review parser", kind: "subagent", status: "done", calls: 2, errors: 0, parent: "main" },
]
const calls = [
  { id: "c1", lane: "main", ts: "2026-01-01T10:00:01Z", name: "Read", kind: "tool", summary: "notes.md", ok: true, input: { file_path: "notes.md" }, result: "hello" },
  { id: "c2", lane: "main", ts: "2026-01-01T10:00:02Z", name: "Bash", kind: "tool", summary: "npm test", ok: false, error: "Exit code 1\nfailed" },
  { id: "c3", lane: "main", ts: "2026-01-01T10:00:03Z", name: "navigate", kind: "mcp", server: "browser", summary: "open settings", ok: true },
  { id: "c4", lane: "main", ts: "2026-01-01T10:00:04Z", name: "Agent", kind: "agent", summary: "Review the parser", ok: true, subLane: "agent-a" },
  { id: "c5", lane: "agent-a", ts: "2026-01-01T10:00:05Z", name: "verification", kind: "skill", summary: "verification", ok: true },
  { id: "c6", lane: "agent-a", ts: "2026-01-01T10:00:06Z", name: "Grep", kind: "tool", summary: "parser in src/", ok: true },
]

function serve(item: object, list: object[]) {
  const fetch = vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => (url.endsWith("/calls") ? list : item) }))
  vi.stubGlobal("fetch", fetch)
  return fetch
}
const chip = (name: RegExp) => screen.getByRole("button", { name })
const rows = () => screen.queryAllByRole("option").map((r) => r.textContent)

describe("Calls tab", () => {
  it("loads the item and its calls, newest first, with counts per chip", async () => {
    const fetch = serve({ summary: { source: "claude-code", id: "s1", title: "t", live: false, status: "idle" }, lanes }, calls)
    render(<Calls source="claude-code" id="s1" />)
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(6))
    expect(fetch.mock.calls.map((c) => c[0]).sort()).toEqual(["/api/item/claude-code/s1", "/api/item/claude-code/s1/calls"])
    expect(rows()[0]).toContain("parser in src/")
    expect(chip(/^All 6$/)).toBeTruthy()
    expect(chip(/Tools 3/)).toBeTruthy()
    expect(chip(/MCP 1/)).toBeTruthy()
    expect(chip(/Skills 1/)).toBeTruthy()
    expect(chip(/Agents 1/)).toBeTruthy()
    expect(chip(/Errors 1/)).toBeTruthy()
  })

  it("a lane narrows the counts; chips and search narrow the rows", async () => {
    serve({ summary: { source: "claude-code", id: "s1", title: "t", live: false, status: "idle" }, lanes }, calls)
    render(<Calls source="claude-code" id="s1" />)
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(6))
    fireEvent.click(within(screen.getByRole("list", { name: "Lanes" })).getByText("Review parser"))
    expect(chip(/^All 2$/)).toBeTruthy()
    expect(chip(/Errors 0/)).toBeTruthy()
    fireEvent.click(within(screen.getByRole("list", { name: "Lanes" })).getByText("All lanes"))
    fireEvent.click(chip(/Errors 1/))
    expect(rows()).toHaveLength(1)
    expect(rows()[0]).toContain("exit 1")
    fireEvent.click(chip(/^All 6$/))
    fireEvent.change(screen.getByLabelText("Search calls"), { target: { value: "PARSER" } })
    expect(rows()).toHaveLength(2) // "Review the parser" (agent) and "parser in src/" (Grep)
    expect(chip(/^All 2$/)).toBeTruthy()
    expect(chip(/Tools 1/)).toBeTruthy()
    expect(chip(/Agents 1/)).toBeTruthy()
  })

  it("picking a call shows its arguments and result, and an agent call links to its lane", async () => {
    serve({ summary: { source: "claude-code", id: "s1", title: "t", live: false, status: "idle" }, lanes }, calls)
    render(<Calls source="claude-code" id="s1" timelineHref={(c) => `#/t/${c.id}`} />)
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(6))
    fireEvent.click(screen.getByText("notes.md"))
    const d = screen.getByLabelText("Call detail")
    expect(d.textContent).toContain('"file_path": "notes.md"')
    expect(d.textContent).toContain("hello")
    expect(within(d).getByText("Show on timeline").getAttribute("href")).toBe("#/t/c1")
    expect(within(d).getByText("Open session").getAttribute("href")).toBe("#/item/claude-code/s1/chat")
    fireEvent.click(screen.getByText("Review the parser"))
    fireEvent.click(within(screen.getByLabelText("Call detail")).getByRole("button", { name: "Review parser" }))
    expect(chip(/^All 2$/)).toBeTruthy()
  })

  it("an item with no lanes and no calls renders empty states", async () => {
    serve({ summary: { source: "ronin", id: "r1", title: "t", live: false, status: "done" }, lanes: [] }, [])
    render(<Calls source="ronin" id="r1" />)
    await waitFor(() => expect(screen.getByText("No calls recorded for this item.")).toBeTruthy())
    expect(screen.getByText("No tool calls.")).toBeTruthy()
    expect(chip(/^All 0$/)).toBeTruthy()
  })

  it("given the item page's item and calls, it shows them and starts no poller of its own", async () => {
    const fetch = serve({}, [])
    const detail = { summary: { source: "claude-code", id: "s1", title: "t", live: true, status: "working" }, lanes } as any
    render(<Calls source="claude-code" id="s1" detail={detail} calls={calls as any} />)
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(6))
    expect(fetch).not.toHaveBeenCalled()
  })
})

