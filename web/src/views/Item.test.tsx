// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ItemDetail } from "@/lib/api"
import Item, { itemTabs } from "./Item"

const tok = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }
const summary = (o: Partial<ItemDetail["summary"]> = {}): ItemDetail["summary"] => ({
  source: "native", id: "r1", kind: "run", title: "Bare run", harness: "native", cwd: null, branch: null, live: false, status: "idle", waiting: false,
  startedAt: null, updatedAt: null, counts: { lanes: 0, calls: 0, errors: 0 }, tokens: tok, cost: 0, ...o,
})

let routes: Record<string, unknown>
beforeEach(() => {
  routes = { "/api/capabilities": { adapter: "native", extras: [], actions: [], source: null }, "/api/sources": [{ name: "native", harness: "native", extras: [], actions: [], source: null }] }
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = url.split("?")[0]
      return path in routes ? { ok: true, status: 200, json: async () => routes[path] } : { ok: false, status: 404, json: async () => ({ error: "no such item" }) }
    }),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("Item page", () => {
  it("an item with no lanes, no calls and no events renders empty states (Review Focus 5)", async () => {
    routes["/api/item/native/r1"] = { summary: summary(), lanes: [], events: [] }
    render(<Item source="native" id="r1" tab="lanes" />)
    await waitFor(() => expect(screen.getByLabelText("Summary")).toBeTruthy())
    expect(screen.getByText("No lanes recorded for this item.")).toBeTruthy()
    expect(screen.getByText("No errors, send-backs or questions.")).toBeTruthy()
    expect(screen.queryByLabelText("Needs you")).toBeNull()
  })

  it("the map of a budget-stopped run lights the stage stopped, not failed, and the rail says Stopped", async () => {
    routes["/api/item/native/r2"] = {
      summary: summary({ id: "r2", status: "stopped", cost: 0.3, counts: { lanes: 2, calls: 3, errors: 0 } }),
      lanes: [
        { id: "spec", label: "spec", kind: "stage", status: "done", calls: 1, errors: 0, tokens: tok, cost: 0.1 },
        { id: "build", label: "build", kind: "stage", status: "stopped", reason: "3 rounds (limit 3)", calls: 2, errors: 0, tokens: tok, cost: 0.2 },
      ],
      events: [
        { type: "stage.start", stage: "spec", ts: "2026-01-01T10:00:00Z" },
        { type: "stage.end", stage: "spec", ok: true, ts: "2026-01-01T10:01:00Z" },
        { type: "stage.start", stage: "build", ts: "2026-01-01T10:02:00Z" },
        { type: "stop", stage: "build", rule: "budget", detail: "3 rounds (limit 3)", ts: "2026-01-01T10:03:00Z" },
      ],
      state: { stages: { spec: { status: "done" }, build: { status: "stopped" } } },
    }
    render(<Item source="native" id="r2" tab="map" />)
    await waitFor(() => expect(document.querySelector('[data-node="build"]')).toBeTruthy())
    const node = document.querySelector('[data-node="build"]') as HTMLElement
    expect(node.dataset.status).toBe("stopped")
    expect(node.textContent).toContain("stopped")
    expect(node.textContent).not.toContain("failed")
    expect(screen.getByLabelText("Stopped").textContent).toContain("Stopped · budget")
    expect(screen.getByLabelText("Summary").textContent).toContain("est.")
  })

  it("an unknown item says so", async () => {
    render(<Item source="native" id="nope" tab="lanes" />)
    await waitFor(() => expect(screen.getByText(/Could not load native · nope/)).toBeTruthy())
  })
})

describe("itemTabs", () => {
  it("lanes first; v1 extras only for the v1 adapter's runs; QA whenever events carry a report", () => {
    expect(itemTabs({ v1Run: false, extras: ["tasks", "diff"], events: [] })).toEqual(["lanes", "map", "calls", "timeline", "chat"])
    expect(itemTabs({ v1Run: true, extras: ["tasks", "diff", "doc"], events: [] })).toEqual(["lanes", "map", "calls", "timeline", "chat", "board", "diff", "docs"])
    expect(itemTabs({ v1Run: false, extras: [], events: [{ type: "qa", rows: [] }] })).toContain("qa")
  })
})
