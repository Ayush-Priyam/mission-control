// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { UsageWindowCard } from "./UsageWindowCard"

afterEach(cleanup)
const base = { available: true as const, harness: "claude-code", estimate: true as const, complete: true, active: true, hours: 5, start: "2026-11-02T09:00:00Z", resetsAt: "2026-11-02T14:00:00Z", used: { tokens: 60000, cost: 1.2 }, rate: { tokensPerHour: 60000, usdPerHour: 1.2 }, eta: null, hitsBeforeReset: false }

describe("UsageWindowCard", () => {
  it("is labelled an estimate and says no limit set", () => {
    render(<UsageWindowCard w={{ ...base, limit: null, message: "No limit set · window resets in ~4h 00m" }} />)
    expect(screen.getByText(/estimate · Claude Code · 5 h window/)).toBeTruthy()
    expect(screen.getByText("No limit set · window resets in ~4h 00m")).toBeTruthy()
    expect(screen.getByText(/not public and are not read here/)).toBeTruthy()
    expect(screen.queryByRole("meter")).toBeNull()
  })
  it("with a limit: the ETA in red and a meter", () => {
    render(<UsageWindowCard w={{ ...base, limit: { tokens: 100000 }, eta: 2400000, hitsBeforeReset: true, message: "At this rate you hit the limit in ~40m" }} />)
    expect(document.querySelector("[data-window-message]")!.className).toContain("text-failed")
    expect(screen.getByRole("meter").getAttribute("aria-valuenow")).toBe("60")
  })
  it("renders nothing when Claude Code is not a source", () => {
    const { container } = render(<UsageWindowCard w={{ available: false }} />)
    expect(container.innerHTML).toBe("")
  })
})
