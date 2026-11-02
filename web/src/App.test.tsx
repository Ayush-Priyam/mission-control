// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import App from "./App"

afterEach(() => { cleanup(); vi.unstubAllGlobals(); location.hash = "" })

// minor 3: /api/runs is polled only by the legacy #/repo view, not on every page.
it("polls /api/runs only on the legacy repo view", async () => {
  const urls: string[] = []
  vi.stubGlobal("fetch", vi.fn(async (u: string) => {
    urls.push(String(u))
    const url = String(u)
    const body = url.includes("/api/overview") ? { counts: { waiting: 0, working: 0, stopped: 0, done: 0 }, needsYou: [], live: [], hidden: 0 }
      : url.includes("/api/capabilities") ? { extras: [], actions: [] }
      : []
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
  }))
  location.hash = "#/"
  render(<App />)
  await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
  expect(urls.some((u) => u.includes("/api/runs"))).toBe(false)
  expect(urls.length).toBeGreaterThan(0)
  cleanup()
  location.hash = "#/repo/shop"
  render(<App />)
  await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
  expect(urls.some((u) => u.includes("/api/runs"))).toBe(true)
})
