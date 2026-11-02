// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { NeedsYouQueue, trackPrompts, NEW_PROMPT_MS } from "./NeedsYouQueue"
import type { NeedsYou } from "@/lib/api"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const NOW = Date.parse("2026-11-02T10:00:30Z")
const ask = (since: string, extra: Partial<NeedsYou> = {}): NeedsYou => ({
  source: "claude-code", id: "s1", title: "fix the build", cwd: "/work/shop", branch: "main", harness: "claude-code",
  updatedAt: since, lane: "main", detail: "Claude needs your permission to use Bash", since, tool: "Bash", target: "npm run build", ...extra,
})

describe("trackPrompts", () => {
  it("the first load flags nothing; a changed since or a newly arrived prompt is new until it expires", () => {
    const a = ask("2026-11-02T10:00:00Z")
    const first = trackPrompts(null, [a], 1000)
    expect(first.fresh.size).toBe(0)
    const same = trackPrompts(first, [a], 2000)
    expect(same.fresh.size).toBe(0)
    const changed = trackPrompts(same, [ask("2026-11-02T10:00:20Z")], 3000)
    expect([...changed.fresh.keys()]).toEqual(["claude-code/s1"])
    expect(changed.fresh.get("claude-code/s1")).toBe(3000 + NEW_PROMPT_MS)
    const other = trackPrompts(changed, [ask("2026-11-02T10:00:20Z"), ask("2026-11-02T10:00:25Z", { id: "s2" })], 4000)
    expect([...other.fresh.keys()].sort()).toEqual(["claude-code/s1", "claude-code/s2"])
    const later = trackPrompts(other, [ask("2026-11-02T10:00:20Z"), ask("2026-11-02T10:00:25Z", { id: "s2" })], 3000 + NEW_PROMPT_MS + 1)
    expect([...later.fresh.keys()]).toEqual(["claude-code/s2"])
  })
})

describe("NeedsYouQueue prompt identity", () => {
  it("each card shows the tool, the command or target, and when it was asked", () => {
    render(<NeedsYouQueue entries={[ask("2026-11-02T10:00:18Z")]} stopped={[]} actions={{}} now={NOW} />)
    const card = screen.getByRole("article")
    expect(card.querySelector("[data-tool]")?.textContent).toBe("Bash")
    expect(card.querySelector("[data-target]")?.textContent).toBe("npm run build")
    expect(card.textContent).toContain("asked 12s ago")
    expect(screen.queryByText("new prompt")).toBeNull()
  })

  it("a replaced prompt shows a 'new prompt' badge and flashes, for about 8 s", () => {
    vi.useFakeTimers({ now: NOW })
    const { rerender } = render(<NeedsYouQueue entries={[ask("2026-11-02T10:00:00Z")]} stopped={[]} actions={{}} now={NOW} />)
    expect(screen.queryByText("new prompt")).toBeNull()
    rerender(<NeedsYouQueue entries={[ask("2026-11-02T10:00:28Z", { tool: "Edit", target: "/work/shop/a.ts" })]} stopped={[]} actions={{}} now={NOW} />)
    expect(screen.getByText("new prompt")).toBeTruthy()
    expect(screen.getByRole("article").className).toContain("mc-flash")
    expect(screen.getByRole("article").querySelector("[data-target]")?.textContent).toBe("/work/shop/a.ts")
    act(() => { vi.advanceTimersByTime(NEW_PROMPT_MS + 100) })
    expect(screen.queryByText("new prompt")).toBeNull()
    expect(screen.getByRole("article").className).not.toContain("mc-flash")
  })
})
