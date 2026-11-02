// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { browserTz, callsUrl, itemsUrl, itemUrl, useCalls, useItem, useOverview, useProjects, useUsage, usageUrl } from "./api"

let urls: string[]
beforeEach(() => {
  urls = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url)
      return { ok: true, status: 200, json: async () => ({ url }) }
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

describe("v2 urls", () => {
  it("item and calls urls encode every segment and skip empty filters", () => {
    expect(itemUrl("claude-code", "a/b")).toBe("/api/item/claude-code/a%2Fb")
    expect(callsUrl("native", "r1")).toBe("/api/item/native/r1/calls")
    expect(callsUrl("native", "r1", { lane: "qa", kind: "", q: "npm test" })).toBe("/api/item/native/r1/calls?lane=qa&q=npm+test")
  })

  it("usage url always carries the time zone", () => {
    expect(usageUrl({}, "Asia/Kolkata")).toBe("/api/usage?by=model&tz=Asia%2FKolkata")
    expect(usageUrl({ from: "2026-10-01", to: "2026-10-31", by: "project" }, "UTC")).toBe(
      "/api/usage?from=2026-10-01&to=2026-10-31&by=project&tz=UTC",
    )
  })

  it("the browser zone comes from Intl", () => {
    expect(browserTz()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  })
})

describe("v2 hooks", () => {
  it("useOverview and useProjects read their routes (the tree slim, in the browser zone)", async () => {
    const o = renderHook(() => useOverview())
    const a = renderHook(() => useOverview(true))
    const p = renderHook(() => useProjects())
    await waitFor(() => expect(o.result.current.data).toEqual({ url: "/api/overview" }))
    await waitFor(() => expect(a.result.current.data).toEqual({ url: "/api/overview?all=1" }))
    await waitFor(() => expect(p.result.current.data).toEqual({ url: `/api/projects?slim=1&tz=${encodeURIComponent(browserTz())}` }))
  })

  it("items url: all, limit and lookup filters", () => {
    expect(itemsUrl()).toBe("/api/items")
    expect(itemsUrl({ all: true, limit: 50 })).toBe("/api/items?all=1&limit=50")
    expect(itemsUrl({ source: "claude-code", id: "a b" })).toBe("/api/items?source=claude-code&id=a+b")
  })

  it("useItem with no id fetches nothing", async () => {
    const { result } = renderHook(() => useItem("native", null))
    expect(result.current.loading).toBe(false)
    expect(urls).toEqual([])
  })

  it("useItem and useCalls fetch the item routes", async () => {
    const i = renderHook(() => useItem("claude-code", "s1"))
    const c = renderHook(() => useCalls("claude-code", "s1", { kind: "mcp" }))
    await waitFor(() => expect(i.result.current.data).toEqual({ url: "/api/item/claude-code/s1" }))
    await waitFor(() => expect(c.result.current.data).toEqual({ url: "/api/item/claude-code/s1/calls?kind=mcp" }))
  })

  it("useUsage sends the browser time zone", async () => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    const { result } = renderHook(() => useUsage({ from: "2026-11-01", by: "day" }))
    await waitFor(() => expect(result.current.data).not.toBeNull())
    expect(urls[0]).toBe(`/api/usage?from=2026-11-01&by=day&tz=${encodeURIComponent(tz)}`)
  })
})
