import { describe, expect, it } from "vitest"
import { fetchReducer, initialFetch } from "./api"

describe("fetchReducer", () => {
  it("poll result on the same url keeps data and replaces it", () => {
    let s = fetchReducer(initialFetch<number>("/a"), { type: "ok", url: "/a", data: 1 })
    s = fetchReducer(s, { type: "fail", url: "/a", error: "boom" })
    expect(s.data).toBe(1)
    expect(s.error).toBe("boom")
    s = fetchReducer(s, { type: "ok", url: "/a", data: 2 })
    expect(s).toMatchObject({ data: 2, error: null, loading: false })
  })
  it("a new url starts clean: no old data, no old error", () => {
    const old = fetchReducer(initialFetch<number>("/a"), { type: "ok", url: "/a", data: 1 })
    expect(initialFetch<number>("/b")).toEqual({ url: "/b", data: null, error: null, loading: true })
    expect(initialFetch<number>(null).loading).toBe(false)
    expect(old.url).toBe("/a")
  })
  it("late results for a previous url are ignored", () => {
    const s = initialFetch<number>("/b")
    expect(fetchReducer(s, { type: "ok", url: "/a", data: 9 })).toBe(s)
    expect(fetchReducer(s, { type: "fail", url: "/a", error: "x" })).toBe(s)
  })
})
