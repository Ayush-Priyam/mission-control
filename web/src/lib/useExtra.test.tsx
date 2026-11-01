// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useExtra } from "./api"
import { runChanges } from "./extras"

afterEach(() => vi.unstubAllGlobals())

describe("useExtra refresh (I1)", () => {
  it("refetches when the refresh key changes, keeping the old data meanwhile", async () => {
    let n = 0
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ n: ++n }) }))
    vi.stubGlobal("fetch", fetch)
    const { result, rerender } = renderHook(({ k }) => useExtra<{ n: number }>("tasks", "r1", undefined, k), { initialProps: { k: 0 } })
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }))
    rerender({ k: 0 })
    expect(fetch).toHaveBeenCalledTimes(1)
    rerender({ k: 1 })
    expect(result.current.data).toEqual({ n: 1 })
    await waitFor(() => expect(result.current.data).toEqual({ n: 2 }))
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[1]).toEqual(["/api/x/tasks/r1"])
  })

  it("the run-scoped key counts stage.end and stop events only", () => {
    expect(runChanges([])).toBe(0)
    expect(runChanges([{ type: "stage.start" }, { type: "progress" }, { type: "session" }])).toBe(0)
    expect(runChanges([{ type: "stage.end" }, { type: "stop" }, { type: "progress" }, { type: "stage.end" }])).toBe(3)
  })
})
