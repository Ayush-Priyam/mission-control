// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fetchReducer, initialFetch, useRun } from "./api"

type Deferred = { resolve: (v: unknown) => void; url: string }
let pending: Deferred[]
let calls: string[]

beforeEach(() => {
  pending = []
  calls = []
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      calls.push(url)
      return new Promise((resolve) => {
        pending.push({ url, resolve: (body) => resolve({ ok: true, status: 200, json: async () => body }) })
      })
    }),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const answer = async (url: string, body: unknown) => {
  const d = pending.filter((p) => p.url === url).pop()!
  await act(async () => d.resolve(body))
}
const A = "/api/run/a"
const B = "/api/run/b"
const run = (name: string) => ({ state: { name }, events: [], live: false })

describe("fetchReducer", () => {
  it("reset adopts a new url, ignores the old one, keeps same-url state", () => {
    let s = fetchReducer(initialFetch<number>("/a"), { type: "ok", url: "/a", data: 1 })
    expect(fetchReducer(s, { type: "reset", url: "/a" })).toBe(s)
    s = fetchReducer(s, { type: "reset", url: "/b" })
    expect(s).toEqual({ url: "/b", data: null, error: null, loading: true })
    expect(fetchReducer(s, { type: "ok", url: "/a", data: 9 })).toBe(s)
  })
})

describe("useRun", () => {
  it("(a) url change clears data, then shows the new url's data", async () => {
    const { result, rerender } = renderHook(({ id }) => useRun(id), { initialProps: { id: "a" as string | null } })
    await answer(A, run("a"))
    expect(result.current.data?.state.name).toBe("a")
    rerender({ id: "b" })
    expect(result.current.data).toBeNull()
    expect(result.current.loading).toBe(true)
    await answer(B, run("b"))
    await waitFor(() => expect(result.current.data?.state.name).toBe("b"))
    expect(result.current.loading).toBe(false)
  })

  it("(b) a late response for the old url is ignored", async () => {
    const { result, rerender } = renderHook(({ id }) => useRun(id), { initialProps: { id: "a" as string | null } })
    rerender({ id: "b" })
    await answer(A, run("a"))
    expect(result.current.data).toBeNull()
    expect(result.current.loading).toBe(true)
    await answer(B, run("b"))
    expect(result.current.data?.state.name).toBe("b")
  })

  it("(c) null then an id loads", async () => {
    const { result, rerender } = renderHook(({ id }) => useRun(id), { initialProps: { id: null as string | null } })
    expect(result.current.loading).toBe(false)
    expect(calls).toEqual([])
    rerender({ id: "a" })
    expect(result.current.loading).toBe(true)
    await answer(A, run("a"))
    expect(result.current.data?.state.name).toBe("a")
  })

  it("(d) A -> B -> A refetches and does not show stale A", async () => {
    const { result, rerender } = renderHook(({ id }) => useRun(id), { initialProps: { id: "a" as string | null } })
    await answer(A, run("a-old"))
    rerender({ id: "b" })
    await answer(B, run("b"))
    rerender({ id: "a" })
    expect(result.current.data).toBeNull()
    expect(result.current.loading).toBe(true)
    await answer(A, run("a-fresh"))
    expect(result.current.data?.state.name).toBe("a-fresh")
  })

  it("(e) a same-url poll keeps data and does not flip loading", async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useRun("a"))
    await answer(A, run("one"))
    expect(result.current.data?.state.name).toBe("one")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(calls.filter((c) => c === A).length).toBe(2)
    expect(result.current.data?.state.name).toBe("one")
    expect(result.current.loading).toBe(false)
    await answer(A, run("two"))
    expect(result.current.data?.state.name).toBe("two")
  })
})
