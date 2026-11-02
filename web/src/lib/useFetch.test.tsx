// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useCalls, useUsage, usageUrl, type Call } from "./api"

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const call = (id: string, ok?: boolean): Call => ({ id, lane: "main", ts: "", name: "Read", kind: "tool", summary: "", ok })
const reply = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  headers: new Headers(),
  json: async () => body,
  text: async () => JSON.stringify(body),
})

describe("useCalls polling (shared useFetch)", () => {
  it("skips unchanged polls, never overlaps requests, refreshes when the tab is visible again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let answer: Call[] = [call("a", true)]
    let release: (() => void) | null = null
    let hold = false
    const fetch = vi.fn(async () => {
      if (hold) await new Promise<void>((r) => (release = r))
      return reply(answer)
    })
    vi.stubGlobal("fetch", fetch)
    const { result } = renderHook(() => useCalls("s", "i", {}, 1000))
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

  it("ok → failed poll → the same calls again clears the error", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const same = [call("a", true)]
    let fail = false
    vi.stubGlobal("fetch", vi.fn(async () => (fail ? reply({}, 500) : reply([...same]))))
    const { result } = renderHook(() => useCalls("s", "i", {}, 1000))
    await waitFor(() => expect(result.current.data).toHaveLength(1))
    fail = true
    await act(() => vi.advanceTimersByTimeAsync(1000))
    await waitFor(() => expect(result.current.error).toContain("500"))
    fail = false
    await act(() => vi.advanceTimersByTimeAsync(1000))
    await waitFor(() => expect(result.current.error).toBeNull())
    expect(result.current.data).toHaveLength(1)
  })

  it("a failed answer's error message reaches the caller", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: "scan exploded" }, 500)))
    const { result } = renderHook(() => useCalls("s", "i", {}, 0))
    await waitFor(() => expect(result.current.error).toBe("scan exploded"))
  })
})

describe("useUsage keeps the last answer of the same kind", () => {
  it("stale while a new range loads; never across a different by", async () => {
    let hold = false
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (hold) await new Promise(() => {})
        return reply({ url, totals: {}, series: [], groups: [], complete: true })
      }),
    )
    const a = usageUrl({ by: "model", from: "2026-10-01" }, "UTC")
    const { result, rerender } = renderHook(({ url }) => useUsage(url), { initialProps: { url: a as string | null } })
    await waitFor(() => expect(result.current.data).not.toBeNull())
    expect(result.current.stale).toBe(false)
    hold = true
    rerender({ url: usageUrl({ by: "model", from: "2026-10-25" }, "UTC") })
    expect(result.current.stale).toBe(true)
    expect((result.current.data as any).url).toBe(a)
    rerender({ url: usageUrl({ by: "project", from: "2026-10-25" }, "UTC") })
    expect(result.current.stale).toBe(false)
    expect(result.current.data).toBeNull()
  })
})
