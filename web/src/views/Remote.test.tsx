// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { RemoteStatus } from "@/lib/remote"
import Remote from "./Remote"

afterEach(cleanup)

const status = (over: Partial<RemoteStatus> = {}): RemoteStatus => ({
  enabled: false,
  host: "laptop.tail1.ts.net",
  remotePort: 4330,
  waitSeconds: 120,
  devices: [{ id: "d1", label: "iPhone", pairedAt: "2026-11-03T10:00:00Z", lastSeenAt: null }],
  pairing: { open: false, expiresAt: null },
  ...over,
})
const json = (code: number, b: unknown) => ({ ok: code < 300, status: code, json: async () => b }) as Response

/** A fake server: GET status, POST enabled. `devices` can be emptied to fake a CLI revoke. */
function fake(initial: RemoteStatus, post?: (enabled: boolean) => Response) {
  let cur = initial
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const r = post!(JSON.parse(String(init.body)).enabled)
      if (r.ok) cur = { ...cur, enabled: JSON.parse(String(init.body)).enabled }
      return r.ok ? json(200, cur) : r
    }
    return json(200, cur)
  }) as any
  return { f, set: (s: RemoteStatus) => (cur = s) }
}

describe("Remote page", () => {
  it("shows status, devices and the copyable commands, with no pair or revoke buttons", async () => {
    const { f } = fake(status())
    render(<Remote f={f} />)
    await screen.findByText("laptop.tail1.ts.net")
    expect(screen.getByText("4330")).toBeTruthy()
    expect(screen.getByText("120 s")).toBeTruthy()
    expect(screen.getByText("iPhone")).toBeTruthy()
    expect(screen.getByText("d1")).toBeTruthy()
    expect(screen.getByText("never", { exact: false })).toBeTruthy()
    for (const c of ["mission-control remote pair", "mission-control remote revoke d1", "mission-control remote on", "mission-control remote off"]) expect(screen.getByText(c)).toBeTruthy()
    // the only controls: copy buttons and the switch
    const names = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"))
    expect(names.every((n) => n?.startsWith("Copy ") || n === "Remote answering")).toBe(true)
  })

  it("an unset host reads 'not set'", async () => {
    render(<Remote f={fake(status({ host: null, remotePort: null })).f} />)
    await screen.findByText("not set", { selector: "dd" }).catch(() => {})
    expect(screen.getAllByText("not set").length).toBeGreaterThan(0)
  })

  it("the switch reflects status and flips only after the server answers", async () => {
    const { f } = fake(status(), () => json(200, {}))
    render(<Remote f={f} />)
    const sw = await screen.findByRole("switch", { name: "Remote answering" })
    expect(sw.getAttribute("aria-checked")).toBe("false")
    fireEvent.click(sw)
    expect((sw as HTMLButtonElement).getAttribute("aria-checked")).toBe("false") // not optimistic
    await waitFor(() => expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true"))
    const post = f.mock.calls.find((c: any[]) => c[1]?.method === "POST")
    expect(post[0]).toBe("/api/remote/enabled")
    expect(post[1].headers["Content-Type"]).toBe("application/json")
  })

  it("a refused switch keeps its state and shows the server's error verbatim", async () => {
    const { f } = fake(status(), () => json(422, { error: "remote.host is not set in /h/config.json", key: "remote.host" }))
    render(<Remote f={f} />)
    fireEvent.click(await screen.findByRole("switch"))
    await screen.findByText("remote.host is not set in /h/config.json")
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false")
  })

  it("an empty device list reads 'No paired devices' after a revoke at the terminal", async () => {
    const { f, set } = fake(status())
    render(<Remote f={f} />)
    await screen.findByText("iPhone")
    set(status({ devices: [] }))
    fireEvent(document, new Event("visibilitychange")) // the page re-fetches when it becomes visible
    await screen.findByText("No paired devices")
    expect(screen.queryByText("iPhone")).toBeNull()
  })
})
