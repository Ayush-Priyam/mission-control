// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import type { Call } from "@/lib/api"
import { CallBreakdown, serverCounts, skillBreakdown, toolBreakdown } from "./CallBreakdown"

afterEach(cleanup)

let n = 0
const c = (over: Partial<Call>): Call => ({ id: `c${n++}`, lane: "main", ts: "2026-01-01T10:00:00Z", name: "Read", kind: "tool", summary: "", ok: true, ...over })
const rep = (k: number, over: Partial<Call>) => Array.from({ length: k }, () => c(over))

const calls = [
  ...rep(5, { name: "Bash" }),
  ...rep(2, { name: "Read" }),
  ...rep(3, { kind: "mcp", server: "browser", name: "click" }),
  ...rep(1, { kind: "mcp", server: "browser", name: "navigate" }),
  ...rep(2, { kind: "mcp", server: "docs", name: "query" }),
  ...rep(2, { kind: "skill", name: "verification" }),
  c({ kind: "skill", name: "debugging", ok: false, error: "missing" }),
  c({ kind: "agent", name: "Agent" }),
]

describe("toolBreakdown", () => {
  it("groups MCP tools under their server, groups ordered by total, skills left out", () => {
    expect(toolBreakdown(calls).map((r) => [r.label, r.count])).toEqual([
      ["Bash", 5],
      ["browser · click", 3],
      ["browser · navigate", 1],
      ["Read", 2],
      ["docs · query", 2],
      ["Agent", 1],
    ])
  })
  it("caps the rows", () => {
    expect(toolBreakdown(calls, 2)).toHaveLength(2)
  })
})

describe("skills and servers", () => {
  it("skills invoked with use counts and failures", () => {
    expect(skillBreakdown(calls)).toEqual([
      { name: "verification", count: 2, errors: 0 },
      { name: "debugging", count: 1, errors: 1 },
    ])
  })
  it("MCP servers by call count", () => {
    expect(serverCounts(calls)).toEqual([{ server: "browser", count: 4 }, { server: "docs", count: 2 }])
  })
  it("BY TOOL keeps a long server's tool name outside the truncating part", () => {
    render(<CallBreakdown calls={[c({ kind: "mcp", server: "plugin_some-very-long_mcp-server-name", name: "work_state_write" })]} />)
    const tool = screen.getByText("· work_state_write")
    expect(tool.parentElement?.closest(".truncate")).toBeNull() // the server part truncates first
    expect(tool.className).toContain("shrink-0")
    expect(tool.className).toContain("max-w-[70%]") // a very long tool name is capped, never overflows into the bar
    expect(tool.className).toContain("truncate")
    expect(screen.getAllByText("plugin_some-very-long_mcp-server-name")[0].className).toContain("truncate")
  })
  it("renders empty states when nothing was called", () => {
    render(<CallBreakdown calls={[]} />)
    expect(screen.getByText("No tool calls.")).toBeTruthy()
    expect(screen.getByText("No skills invoked.")).toBeTruthy()
  })
})
