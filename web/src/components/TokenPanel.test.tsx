// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TokenPanel } from "./TokenPanel"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const tok = { input: 1000, output: 200, cache_creation: 300, cache_read: 9000, billable: 1500 }

describe("TokenPanel (I3)", () => {
  it("optional: shows the spend when the run's tokens extra answers 200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ available: true, total: tok, sessions: [] }) })))
    render(<TokenPanel runId="r1" optional />)
    await waitFor(() => expect(screen.getByLabelText("Token spend")).toBeTruthy())
    expect(screen.getByText("1.5k")).toBeTruthy()
  })

  it("optional: hides itself when the run has no transcript tokens (404)", async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ error: "no transcript tokens for this run" }) }))
    vi.stubGlobal("fetch", fetch)
    const { container } = render(<TokenPanel runId="r1" optional />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 0))
    expect(container.innerHTML).toBe("")
  })
})
