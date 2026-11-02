// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import Turns, { sortTurns } from "./Turns"

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const t = (i: number, cost: number, compacted = false, why: string | null = null) => ({ i, ts: "2026-11-02T10:00:00Z", model: "m", in: 1, out: 2, cacheRead: 3, cacheWrite: 4, context: 8, cost, compacted, why })
const data = { lane: "main", turns: [t(0, 0.5, false, "large cache write: new context"), t(1, 2), t(2, 0.1, true, "context compacted before this turn")], total: { cost: 2.6, turns: 3, compactions: 1 } }

describe("Turns", () => {
  it("sorts by cost, keeps file order otherwise", () => {
    expect(sortTurns(data.turns, "cost").map((x) => x.i)).toEqual([1, 0, 2])
    expect(sortTurns(data.turns, "order").map((x) => x.i)).toEqual([0, 1, 2])
  })
  it("lists turns with a compaction marker and why hints; sorting by cost drops the marker", async () => {
    const fetch = vi.fn(async (_url: string) => ({ ok: true, status: 200, json: async () => data }))
    vi.stubGlobal("fetch", fetch)
    render(<Turns source="claude-code" id="s1" lanes={[{ id: "main", label: "main" } as any]} live={false} />)
    await waitFor(() => expect(document.querySelectorAll("[data-turn]")).toHaveLength(3))
    expect(fetch.mock.calls[0][0]).toBe("/api/item/claude-code/s1/turn-costs?lane=main")
    expect(document.querySelectorAll("[data-compaction]")).toHaveLength(1)
    expect(screen.getByText("large cache write: new context")).toBeTruthy()
    expect(screen.getByText(/3 turns · \$2\.60 est\. · 1 compaction/)).toBeTruthy()
    fireEvent.click(screen.getByRole("tab", { name: "by cost" }))
    expect(document.querySelectorAll("[data-turn]")[0].textContent).toContain("$2.00")
    expect(document.querySelectorAll("[data-compaction]")).toHaveLength(0)
  })
})
