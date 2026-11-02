// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ItemSummary, Lane, LoopInfo, LoopingItem, Overview } from "@/lib/api"
import { loopLine, sinceChangeLine } from "@/lib/format"
import { buildTokens, PRESETS, STATUS, type Mode } from "@/lib/themes"
import { contrast } from "@/lib/contrast"
import { chipCounts, StatusChips } from "./StatusChips"
import { LaneCard } from "./LaneCards"
import { LoopingList } from "./LoopingList"
import { ItemTable, sortItems } from "./ItemTable"

afterEach(cleanup)
const NOW = Date.parse("2026-11-02T10:14:00Z")
const loop: LoopInfo = { looping: true, rule: "repeat", since: "2026-11-02T10:00:00Z", failures: 9, costSince: 3.2, firstCallId: "tu7", reason: "npm test failed 9×", command: "npm test", lane: "main" }

describe("looping text", () => {
  it("says how long, what failed how often, and the estimated cost since", () => {
    expect(loopLine(loop, NOW)).toBe("looping 14m · npm test failed 9× · $3.20 est. since")
  })
  it("tokens and time since the last file change", () => {
    expect(sinceChangeLine({ tokens: 412_000, ms: 18 * 60_000 })).toBe("412k tok since last change · 18m")
    expect(sinceChangeLine(undefined)).toBe(null)
  })
})

describe("looping colour", () => {
  it("has its own token in every preset and mode, readable as text and as a dot, distinct from failed and needs you", () => {
    for (const p of Object.values(PRESETS))
      for (const mode of ["light", "dark"] as Mode[]) {
        const t = buildTokens(p.spec, mode).tokens
        for (const bg of ["--background", "--card", "--muted"]) expect(contrast(t["--looping"], t[bg])).toBeGreaterThanOrEqual(4.5)
        expect(t["--looping"]).not.toBe(t["--failed"])
        expect(t["--looping"]).not.toBe(t["--needs-you"])
      }
    expect(STATUS.color.dark.looping).toBeTruthy()
  })
})

describe("Looping chip", () => {
  it("counts looping items and filters on click", () => {
    const o: Overview = { counts: { waiting: 0, working: 1, stopped: 0, done: 0, ready: 0, looping: 2 }, needsYou: [], live: [], hidden: 0 }
    const onPick = vi.fn()
    render(<StatusChips counts={chipCounts(o, 0)} active={null} onPick={onPick} />)
    const chip = screen.getByRole("button", { name: /Looping/ })
    expect(chip.textContent).toContain("2")
    expect(chip.className).toContain("text-looping")
    fireEvent.click(chip)
    expect(onPick).toHaveBeenCalledWith("looping")
  })
})

const lane = (extra: Partial<Lane> = {}): Lane => ({ id: "main", label: "main", kind: "main", status: "looping", calls: 20, errors: 9, tokens: { in: 1, out: 1, cacheRead: 0, cacheWrite: 0 }, cost: 4, loop, sinceChange: { tokens: 412_000, since: "2026-11-02T09:56:00Z", ms: 18 * 60_000 }, ...extra })

describe("LaneCard looping", () => {
  it("shows the looping line and a link to the first failing call on the Calls tab", () => {
    render(<LaneCard lane={lane()} now={NOW} callHref={(id) => `#/item/claude-code/s1/calls?call=${id}`} />)
    expect(screen.getByText("looping 14m · npm test failed 9× · $3.20 est. since")).toBeTruthy()
    const link = screen.getByRole("link", { name: /first failing call/ })
    expect(link.getAttribute("data-href")).toBe("#/item/claude-code/s1/calls?call=tu7")
    expect(screen.getByText("412k tok since last change · 18m")).toBeTruthy()
  })
  it("a working lane shows tokens since last change but no looping line", () => {
    render(<LaneCard lane={lane({ status: "working", loop: undefined })} now={NOW} />)
    expect(screen.queryByText(/^looping/)).toBeNull()
    expect(screen.getByText("412k tok since last change · 18m")).toBeTruthy()
  })
})

describe("LoopingList (Home)", () => {
  it("one row per looping item with the looping line, linking to the first failing call", () => {
    const e: LoopingItem = { source: "claude-code", id: "s1", title: "fix cart", cwd: "/w", branch: "main", harness: "claude-code", updatedAt: null, lane: "main", loop, sinceChange: null }
    render(<LoopingList entries={[e]} now={NOW} />)
    expect(screen.getByText("Looping")).toBeTruthy()
    expect(screen.getByText("looping 14m · npm test failed 9× · $3.20 est. since")).toBeTruthy()
    expect(screen.getByRole("link", { name: "fix cart" }).getAttribute("href")).toBe("#/item/claude-code/s1/calls?call=tu7")
  })
})

const item = (id: string, tokens: number | null): ItemSummary => ({
  source: "s", id, kind: "session", title: id, harness: "claude-code", cwd: null, branch: null, live: false, status: "idle", waiting: false, startedAt: null, updatedAt: "2026-11-02T10:00:00Z",
  counts: { lanes: 1, calls: 1, errors: 0 }, tokens: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }, cost: 0, ...(tokens === null ? {} : { sinceChange: { tokens, since: null, ms: 60_000 } }),
})

describe("ItemTable: tokens since last change", () => {
  it("is a sortable column (unknown sorts last)", () => {
    const rows = [item("a", 1000), item("b", 500_000), item("c", null)]
    expect(sortItems(rows, "sinceChange", "desc").map((i) => i.id)).toEqual(["b", "a", "c"])
    render(<ItemTable items={rows} now={NOW} />)
    const head = screen.getByRole("button", { name: /Since change/ })
    fireEvent.click(head)
    const body = screen.getAllByRole("row").slice(1)
    expect(within(body[0]).getByText("500k")).toBeTruthy()
  })
})
