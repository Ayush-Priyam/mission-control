// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { sameCalls, useItemCalls, type Call } from "./calls-api"

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const call = (id: string, ok?: boolean): Call => ({ id, lane: "main", ts: "", name: "Read", kind: "tool", summary: "", ok })

describe("sameCalls", () => {
  it("same count, last id and last outcome", () => {
    expect(sameCalls([call("a"), call("b", true)], [call("a"), call("b", true)])).toBe(true)
    expect(sameCalls([call("a")], [call("a"), call("b")])).toBe(false)
    expect(sameCalls([call("a"), call("b")], [call("a"), call("c")])).toBe(false)
    expect(sameCalls([call("b")], [call("b", true)])).toBe(false) // a pending call got its result
  })
})

describe("useItemCalls polling", () => {
  it("skips unchanged polls, never overlaps requests, refreshes when the tab is visible again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let answer: Call[] = [call("a", true)]
    let release: (() => void) | null = null
    let hold = false
    const fetch = vi.fn(async () => {
      if (hold) await new Promise<void>((r) => (release = r))
      const body = answer
      return { ok: true, status: 200, json: async () => body }
    })
    vi.stubGlobal("fetch", fetch)
    const { result } = renderHook(() => useItemCalls("s", "i", 1000))
    await waitFor(() => expect(result.current.data).toHaveLength(1))
    const first = result.current.data

    answer = [call("a", true)] // a new array with the same calls
    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(result.current.data).toBe(first) // not dispatched

    hold = true // a slow request: later ticks must not start another
    await act(() => vi.advanceTimersByTimeAsync(3000))
    expect(fetch).toHaveBeenCalledTimes(3)
    hold = false
    answer = [call("a", true), call("b")]
    await act(async () => release?.())
    await waitFor(() => expect(result.current.data).toHaveLength(2))

    const n = fetch.mock.calls.length
    await act(async () => document.dispatchEvent(new Event("visibilitychange")))
    expect(fetch.mock.calls.length).toBe(n + 1)
  })
})
