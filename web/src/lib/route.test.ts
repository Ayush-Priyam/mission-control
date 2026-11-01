import { describe, expect, it } from "vitest"
import { parseRoute, toHash } from "./route"

describe("route", () => {
  it("parses a run tab", () => {
    expect(parseRoute("#/run/abc/trace")).toEqual({ view: "run", id: "abc", tab: "trace" })
  })
  it("defaults to home and the map tab", () => {
    expect(parseRoute("")).toEqual({ view: "home" })
    expect(parseRoute("#/run/abc")).toEqual({ view: "run", id: "abc", tab: "map" })
    expect(parseRoute("#/run/abc/nope")).toEqual({ view: "run", id: "abc", tab: "map" })
    expect(parseRoute("#/bogus")).toEqual({ view: "home" })
  })
  it("round-trips", () => {
    for (const h of ["#/", "#/project/" + encodeURIComponent("/a b/repo"), "#/run/abc/qa", "#/agent/abc/plan"]) {
      expect(toHash(parseRoute(h))).toBe(h)
    }
  })
})
