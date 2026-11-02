// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createLoader } from "./api"
import { freshness, lastSeen, markFail, markOk, resetFreshness, STALE_MS } from "./freshness"
import { FreshnessBadge } from "@/components/Freshness"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  resetFreshness()
  document.documentElement.removeAttribute("data-stale")
})

describe("freshness", () => {
  it("connecting before any answer, live while recent, stale after 15s", () => {
    expect(freshness(1000, 0, 0).state).toBe("connecting")
    expect(freshness(1000, 0, 500).state).toBe("stale")
    expect(freshness(10_000, 8_000, 0)).toEqual({ state: "live", ageS: 2 })
    expect(freshness(8_000 + STALE_MS + 1, 8_000, 0).state).toBe("stale")
  })

  it("every good answer counts, a 304 or an HTTP error included; a network failure does not", async () => {
    const res = (status: number) => vi.fn(async () => ({ ok: status < 300, status, json: async () => ({ error: "nope" }), text: async () => "{}", headers: { get: () => '"e1"' } as any }))
    for (const status of [200, 304, 404]) {
      resetFreshness()
      await createLoader("/x", () => {}, () => {}, res(status) as any)()
      expect([status, lastSeen().ok > 0]).toEqual([status, true])
    }
    resetFreshness()
    await createLoader("/x", () => {}, () => {}, vi.fn(async () => { throw new TypeError("Failed to fetch") }) as any)()
    expect(lastSeen().ok).toBe(0)
    expect(lastSeen().fail).toBeGreaterThan(0)
  })

  it("the badge reads live · Ns, then stale after 15s of silence: html[data-stale] stops the pulses; an answer reconnects", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-11-02T10:00:00Z"))
    render(<FreshnessBadge />)
    expect(screen.getByText("connecting…")).toBeTruthy()
    act(() => markOk())
    act(() => vi.advanceTimersByTime(2000))
    expect(screen.getByText("live · 2s")).toBeTruthy()
    expect(document.documentElement.hasAttribute("data-stale")).toBe(false)
    act(() => markFail())
    act(() => vi.advanceTimersByTime(STALE_MS))
    expect(screen.getByText(/stale · 17s · retrying/)).toBeTruthy()
    expect(document.documentElement.hasAttribute("data-stale")).toBe(true)
    act(() => markOk())
    expect(screen.getByText("live · 0s")).toBeTruthy()
    expect(document.documentElement.hasAttribute("data-stale")).toBe(false)
  })
})
