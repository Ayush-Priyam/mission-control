// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { RemoteApp, type RemoteApi } from "./RemoteApp"

class FakeES {
  static last: FakeES
  h = new Map<string, (() => void)[]>()
  constructor(public url: string) { FakeES.last = this }
  addEventListener(n: string, fn: () => void) { this.h.set(n, [...(this.h.get(n) ?? []), fn]) }
  close() {}
  emit(n: string) { for (const fn of this.h.get(n) ?? []) fn() }
}
const make = (u: string) => new FakeES(u) as unknown as EventSource
const api = (over: Partial<RemoteApi> = {}): RemoteApi => ({
  me: async () => ({ kind: "ok", device: { id: "d", label: "l" } }),
  prompts: async () => ({ kind: "ok", prompts: [] }),
  answer: async () => ({ kind: "ok" }),
  ...over,
})

beforeEach(() => history.replaceState(null, "", "/"))
afterEach(cleanup)

describe("RemoteApp", () => {
  it("not paired shows the pair command", async () => {
    render(<RemoteApp api={api({ me: async () => ({ kind: "not-paired" }) })} makeEventSource={make} />)
    await screen.findByText(/on your computer/)
  })

  it("revoked shows the revoked screen", async () => {
    render(<RemoteApp api={api({ me: async () => ({ kind: "revoked" }) })} makeEventSource={make} />)
    await screen.findByText("This device was revoked. Pair again.")
  })

  it("paired: loads prompts, and refetches on 'changed'", async () => {
    const entry = { source: "claude-code", id: "s", title: "T", lane: "main", tool: "Bash", target: "ls", since: new Date().toISOString(), answerable: false }
    const prompts = vi.fn().mockResolvedValueOnce({ kind: "ok", prompts: [] }).mockResolvedValue({ kind: "ok", prompts: [entry] })
    render(<RemoteApp api={api({ prompts })} makeEventSource={make} />)
    await screen.findByText("Nothing needs you right now.")
    FakeES.last.emit("changed")
    await screen.findByText("answer where the agent runs")
    expect(prompts).toHaveBeenCalledTimes(2)
  })

  it("a revoked 401 on the list switches to the revoked screen", async () => {
    render(<RemoteApp api={api({ prompts: async () => ({ kind: "revoked" }) })} makeEventSource={make} />)
    await waitFor(() => screen.getByText("This device was revoked. Pair again."))
  })

  it("a first load that fails at the network shows the offline banner over still skeletons", async () => {
    render(<RemoteApp api={api({ prompts: async () => ({ kind: "offline" }) })} makeEventSource={make} />)
    await screen.findByText("offline, can't answer")
    expect(document.querySelectorAll("[data-skeleton]")).toHaveLength(2)
    expect(document.querySelector("[data-skeleton]")!.className).toContain("animate-none")
  })
})
