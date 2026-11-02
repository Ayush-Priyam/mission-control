// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ItemDetail, Turn } from "@/lib/api"
import Item from "./Item"

const tok = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }
const summary = (o: Partial<ItemDetail["summary"]> = {}): ItemDetail["summary"] => ({
  source: "native", id: "r1", kind: "run", title: "Bare run", harness: "native", cwd: null, branch: null, live: false, status: "idle", waiting: false,
  startedAt: null, updatedAt: null, counts: { lanes: 0, calls: 0, errors: 0 }, tokens: tok, cost: 0, ...o,
})
const T = (s: number) => `2026-11-02T09:00:${String(s).padStart(2, "0")}.000Z`
const lane = (id: string, o: Record<string, unknown> = {}) => ({ id, label: id === "main" ? "main" : `Review ${id}`, kind: id === "main" ? "main" : "subagent", status: "done", calls: 1, errors: 0, tokens: tok, cost: 0, ...o })
const session = () => ({
  summary: summary({ source: "claude-code", id: "s1", kind: "session", harness: "claude-code", title: "Cart page" }),
  lanes: [lane("main", { startedAt: T(0), endedAt: T(50) }), lane("agent-a1", { startedAt: T(20), endedAt: T(40), parent: "main" })],
  events: [],
})
const calls = [
  { id: "c1", lane: "main", ts: T(5), name: "Bash", kind: "tool", summary: "npm test", ok: false, error: "1 failing" },
  { id: "c2", lane: "main", ts: T(10), name: "docs", kind: "mcp", server: "ctx", summary: "routing", ok: true },
  { id: "c3", lane: "main", ts: T(19), name: "Agent", kind: "agent", summary: "review", ok: true, subLane: "agent-a1" },
  { id: "c4", lane: "agent-a1", ts: T(25), name: "Read", kind: "tool", summary: "cart.ts", ok: true },
]

let routes: Record<string, unknown>
let fetched: string[]
beforeEach(() => {
  fetched = []
  routes = {
    "/api/capabilities": { adapter: "native", extras: [], actions: [], source: null },
    "/api/sources": [{ name: "native", harness: "native", extras: [], actions: [], source: null }, { name: "claude-code", harness: "claude-code", extras: [], actions: [], source: null }],
  }
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      fetched.push(url)
      const hit = url in routes ? routes[url] : routes[url.split("?")[0]]
      return hit !== undefined ? { ok: true, status: 200, json: async () => hit } : { ok: false, status: 404, json: async () => ({ error: "not found" }) }
    }),
  )
  location.hash = ""
  Element.prototype.scrollIntoView = () => {}
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("Timeline tab", () => {
  it("a claude-code session draws a row per lane with its calls as ticks; a tick opens that call on the Calls tab", async () => {
    routes["/api/item/claude-code/s1"] = session()
    routes["/api/item/claude-code/s1/calls"] = calls
    render(<Item source="claude-code" id="s1" tab="timeline" />)
    await waitFor(() => expect(document.querySelector('[data-lane-row="agent-a1"]')).toBeTruthy())
    const rows = [...document.querySelectorAll("[data-lane-row]")].map((r) => r.getAttribute("data-lane-row"))
    expect(rows).toEqual(["main", "agent-a1"])
    const main = document.querySelector('[data-lane-row="main"]')!
    expect([...main.querySelectorAll("[data-tick]")].map((t) => t.getAttribute("data-tick"))).toEqual(["error", "mcp", "agent"])
    expect(main.querySelector("[data-bar]")).toBeTruthy()
    fireEvent.click(screen.getByLabelText(/^ctx\.docs routing at/))
    expect(location.hash).toBe("#/item/claude-code/s1/calls?call=c2")
  })

  it("an item with no lanes and no calls renders the empty state (Review Focus 5)", async () => {
    routes["/api/item/native/r1"] = { summary: summary(), lanes: [], events: [] }
    routes["/api/item/native/r1/calls"] = []
    render(<Item source="native" id="r1" tab="timeline" />)
    await waitFor(() => expect(screen.getByText("No lanes or calls recorded for this item yet.")).toBeTruthy())
  })

  it("Chat of a bare item: a run of another source says there is no transcript; a bare v1 run shows its empty thread (Review Focus 5)", async () => {
    routes["/api/item/other/r1"] = { summary: summary({ source: "other" }), lanes: [], events: [] }
    render(<Item source="other" id="r1" tab="chat" />)
    await waitFor(() => expect(screen.getByText("No transcript recorded for this item.")).toBeTruthy())
    cleanup()
    routes["/api/item/native/r1"] = { summary: summary(), lanes: [], events: [] }
    render(<Item source="native" id="r1" tab="chat" />)
    await waitFor(() => expect(screen.getByText("No events yet.")).toBeTruthy())
  })
})

describe("Chat tab", () => {
  const turn = (i: number, o: Partial<Turn> = {}): Turn => ({ i, role: i % 2 ? "assistant" : "user", ts: T(i % 60), text: `turn ${i}`, tools: [], ...o })

  it("shows the newest page of turns, tool chips expand to arguments and result, earlier pages load on demand", async () => {
    routes["/api/item/claude-code/s1"] = session()
    routes["/api/item/claude-code/s1/calls"] = calls
    const newest = Array.from({ length: 60 }, (_, k) => turn(140 + k))
    newest[59] = turn(199, { text: "Done.", tools: [{ id: "c1", name: "Bash", kind: "tool", summary: "npm test", input: { command: "npm test" }, ok: false, error: "1 failing" }] })
    routes["/api/item/claude-code/s1/turns?lane=main&limit=60"] = { lane: "main", total: 200, start: 140, turns: newest }
    routes["/api/item/claude-code/s1/turns?lane=main&before=140&limit=60"] = { lane: "main", total: 200, start: 80, turns: Array.from({ length: 60 }, (_, k) => turn(80 + k)) }
    render(<Item source="claude-code" id="s1" tab="chat" />)
    await waitFor(() => expect(screen.getByText("Done.")).toBeTruthy())
    expect(document.querySelectorAll("[data-turn]").length).toBe(60)
    const chip = screen.getByRole("button", { expanded: false, name: /Bash/ })
    fireEvent.click(chip)
    const detail = screen.getByLabelText("Bash detail")
    expect(detail.textContent).toContain('"command": "npm test"')
    expect(detail.textContent).toContain("1 failing")
    expect(detail.querySelector("a")!.getAttribute("href")).toBe("#/item/claude-code/s1/calls?call=c1")
    fireEvent.click(screen.getByText("Load earlier (140 more)"))
    await waitFor(() => expect(document.querySelectorAll("[data-turn]").length).toBe(120))
    expect(document.querySelector("[data-turn]")!.getAttribute("data-turn")).toBe("80")
    expect(screen.getByText("Load earlier (80 more)")).toBeTruthy()
  })

  it("the lane picker switches to a sub-agent's transcript", async () => {
    routes["/api/item/claude-code/s1"] = session()
    routes["/api/item/claude-code/s1/calls"] = calls
    routes["/api/item/claude-code/s1/turns?lane=main&limit=60"] = { lane: "main", total: 1, start: 0, turns: [turn(0, { text: "main says" })] }
    routes["/api/item/claude-code/s1/turns?lane=agent-a1&limit=60"] = { lane: "agent-a1", total: 1, start: 0, turns: [turn(0, { text: "review it" })] }
    render(<Item source="claude-code" id="s1" tab="chat" />)
    await waitFor(() => expect(screen.getByText("main says")).toBeTruthy())
    fireEvent.change(screen.getByLabelText("Lane"), { target: { value: "agent-a1" } })
    await waitFor(() => expect(screen.getByText("review it")).toBeTruthy())
    expect(screen.queryByText("main says")).toBeNull()
  })
})

describe("chat blocks", () => {
  it("runs of assistant turns read as one block; user turns stay their own", async () => {
    const { blocks } = await import("./Chat")
    const t = (i: number, role: "user" | "assistant"): Turn => ({ i, role, ts: null, text: "", tools: [] })
    expect(blocks([t(0, "user"), t(1, "assistant"), t(2, "assistant"), t(3, "user"), t(4, "user"), t(5, "assistant")]).map((b) => b.turns.map((x) => x.i))).toEqual([[0], [1, 2], [3], [4], [5]])
  })
  it("user turns the harness injected (task notifications, system reminders) are their own system blocks", async () => {
    const { blocks, systemNote } = await import("./Chat")
    const t = (i: number, role: "user" | "assistant", text = ""): Turn => ({ i, role, ts: null, text, tools: [] })
    const note = "<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n<summary>Agent \"Review parser\" completed</summary>\n</task-notification>"
    expect(blocks([t(0, "user", "fix it"), t(1, "user", note), t(2, "user", "  <system-reminder>be brief</system-reminder>"), t(3, "assistant")]).map((b) => [b.role, b.turns.map((x) => x.i)])).toEqual([
      ["user", [0]],
      ["system", [1]],
      ["system", [2]],
      ["assistant", [3]],
    ])
    expect(systemNote(note)).toEqual({ kind: "task-notification", text: 'Agent "Review parser" completed' })
    expect(systemNote("<system-reminder>be brief</system-reminder>")).toEqual({ kind: "system-reminder", text: "be brief" })
    expect(systemNote("hello <system-reminder>x</system-reminder>")).toBeNull()
  })
})

describe("Chat system notes", () => {
  it("render as a dim one-line chip that expands to the raw text", async () => {
    routes["/api/item/claude-code/s1"] = session()
    routes["/api/item/claude-code/s1/calls"] = calls
    const raw = "<task-notification><summary>Agent done</summary><result>long body</result></task-notification>"
    routes["/api/item/claude-code/s1/turns?lane=main&limit=60"] = { lane: "main", total: 2, start: 0, turns: [{ i: 0, role: "user", ts: T(0), text: raw, tools: [] }, { i: 1, role: "assistant", ts: T(1), text: "ok", tools: [] }] }
    render(<Item source="claude-code" id="s1" tab="chat" />)
    await waitFor(() => expect(screen.getByText("ok")).toBeTruthy())
    const chip = screen.getByRole("button", { name: /system note/i })
    expect(chip.textContent).toContain("task-notification")
    expect(chip.textContent).toContain("Agent done")
    expect(screen.queryByText(/long body/)).toBeNull()
    expect(document.body.textContent).not.toContain("YOU#1")
    fireEvent.click(chip)
    expect(screen.getByText(/long body/)).toBeTruthy()
  })
})

describe("Timeline zoom", () => {
  it("+ and − widen and narrow the track; ctrl+wheel zooms too; fit resets", async () => {
    routes["/api/item/claude-code/s1"] = session()
    routes["/api/item/claude-code/s1/calls"] = calls
    render(<Item source="claude-code" id="s1" tab="timeline" />)
    await waitFor(() => expect(document.querySelectorAll("[data-tick]").length).toBe(4))
    const track = () => document.querySelector("[data-track]") as HTMLElement
    expect(track().dataset.zoom).toBe("1")
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }))
    expect(track().dataset.zoom).toBe("2")
    expect(track().style.width).toContain("2")
    fireEvent.wheel(document.querySelector("[data-scroller]")!, { deltaY: -100, ctrlKey: true })
    expect(Number(track().dataset.zoom)).toBeGreaterThan(2)
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }))
    fireEvent.click(screen.getByRole("button", { name: "Fit" }))
    expect(track().dataset.zoom).toBe("1")
  })
})

