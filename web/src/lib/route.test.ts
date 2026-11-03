import { describe, expect, it } from "vitest"
import { parseRoute, toHash } from "./route"

describe("route (v2)", () => {
  it("parses home, usage, project, worktree and item", () => {
    expect(parseRoute("")).toEqual({ view: "home" })
    expect(parseRoute("#/")).toEqual({ view: "home" })
    expect(parseRoute("#/usage")).toEqual({ view: "usage" })
    expect(parseRoute("#/project/app-1a2b3c4d")).toEqual({ view: "project", key: "app-1a2b3c4d" })
    expect(parseRoute(`#/worktree/app-1a2b3c4d/${encodeURIComponent("/w/app-feat")}`)).toEqual({
      view: "worktree",
      key: "app-1a2b3c4d",
      path: "/w/app-feat",
    })
    expect(parseRoute("#/item/claude-code/abc-123/calls")).toEqual({ view: "item", source: "claude-code", id: "abc-123", tab: "calls" })
  })

  it("an item link can name a call to open", () => {
    expect(parseRoute("#/item/claude-code/s1/calls?call=toolu_1")).toEqual({ view: "item", source: "claude-code", id: "s1", tab: "calls", call: "toolu_1" })
    expect(toHash({ view: "item", source: "claude-code", id: "s1", tab: "calls", call: "a b" })).toBe("#/item/claude-code/s1/calls?call=a%20b")
    expect(parseRoute(toHash({ view: "item", source: "x", id: "y", tab: "calls", call: "a b" }))).toMatchObject({ call: "a b" })
  })

  it("defaults the item tab to lanes and rejects odd tab names", () => {
    expect(parseRoute("#/item/native/r1")).toEqual({ view: "item", source: "native", id: "r1", tab: "lanes" })
    expect(parseRoute("#/item/native/r1/%3Cx%3E")).toEqual({ view: "item", source: "native", id: "r1", tab: "lanes" })
  })

  it("incomplete or unknown routes fall back to home", () => {
    for (const h of ["#/bogus", "#/project", "#/worktree/k", "#/item/native", "#/item"]) expect(parseRoute(h)).toEqual({ view: "home" })
  })

  it("keeps the v1 run, agent and repo pages reachable", () => {
    expect(parseRoute("#/run/abc/trace")).toEqual({ view: "run", id: "abc", tab: "trace" })
    expect(parseRoute("#/run/abc")).toEqual({ view: "run", id: "abc", tab: "map" })
    expect(parseRoute("#/run/abc/nope")).toEqual({ view: "run", id: "abc", tab: "map" })
    expect(parseRoute("#/agent/abc/plan")).toEqual({ view: "agent", id: "abc", stage: "plan" })
    expect(parseRoute("#/repo/tipcalc")).toEqual({ view: "repo", repo: "tipcalc" })
  })

  it("round-trips every view, including paths with slashes and spaces", () => {
    const hashes = [
      "#/",
      "#/usage",
      "#/project/app-1a2b3c4d",
      `#/worktree/app-1a2b3c4d/${encodeURIComponent("/a b/repo")}`,
      "#/item/claude-code/abc/lanes",
      `#/item/native/${encodeURIComponent("2026 run")}/board`,
      "#/run/abc/qa",
      "#/agent/abc/plan",
      "#/repo/tipcalc",
    ]
    for (const h of hashes) expect(toHash(parseRoute(h))).toBe(h)
  })
})

describe("route (remote)", () => {
  it("parses and builds #/remote", async () => {
    const { parseRoute, toHash } = await import("./route")
    expect(parseRoute("#/remote")).toEqual({ view: "remote" })
    expect(toHash({ view: "remote" })).toBe("#/remote")
  })
})
