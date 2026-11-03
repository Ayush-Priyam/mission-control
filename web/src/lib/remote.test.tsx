// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { answer, connectRemoteEvents, me, pair, prompts, reasonText, setRemoteEnabled, useOnline } from "./remote"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const res = (status: number, b: unknown = {}) => ({ status, ok: status < 300, json: async () => b }) as unknown as Response
const fetchOf = (r: Response | Error) => vi.fn(async () => { if (r instanceof Error) throw r; return r }) as unknown as typeof fetch & ReturnType<typeof vi.fn>

class FakeES {
  static last: FakeES
  url: string
  closed = false
  h = new Map<string, (() => void)[]>()
  constructor(url: string) { this.url = url; FakeES.last = this }
  addEventListener(n: string, fn: () => void) { this.h.set(n, [...(this.h.get(n) ?? []), fn]) }
  close() { this.closed = true }
  emit(n: string) { for (const fn of this.h.get(n) ?? []) fn() }
}
const make = (u: string) => new FakeES(u) as unknown as EventSource

describe("reasonText", () => {
  it("has the four exact texts, and anything else reads as gone", () => {
    expect(reasonText("changed")).toBe("prompt changed, nothing was approved")
    expect(reasonText("answered")).toBe("already answered")
    expect(reasonText("terminal")).toBe("answered in terminal")
    expect(reasonText("gone")).toBe("no longer waiting")
    expect(reasonText("weird")).toBe("no longer waiting")
  })
})

describe("pair / me / prompts", () => {
  it("pair posts JSON with the token and maps 200, 401 and 429", async () => {
    const f = fetchOf(res(200, { device: { id: "d1", label: "iPhone" } }))
    expect(await pair("tok", f)).toEqual({ kind: "ok", device: { id: "d1", label: "iPhone" } })
    const [url, init] = (f as any).mock.calls[0]
    expect(url).toBe("/api/remote/pair")
    expect(init.method).toBe("POST")
    expect(init.headers["Content-Type"]).toBe("application/json")
    expect(init.credentials).toBe("same-origin")
    expect(JSON.parse(init.body)).toEqual({ token: "tok" })
    expect(await pair("t", fetchOf(res(401, { error: "x" })))).toEqual({ kind: "expired" })
    expect(await pair("t", fetchOf(res(429)))).toEqual({ kind: "limited" })
    expect(await pair("t", fetchOf(new TypeError("net")))).toEqual({ kind: "offline" })
  })

  it("me tells not paired from revoked by the exact error string", async () => {
    expect(await me(fetchOf(res(200, { device: { id: "d", label: "l" } })))).toMatchObject({ kind: "ok" })
    expect(await me(fetchOf(res(401, { error: "not paired" })))).toEqual({ kind: "not-paired" })
    expect(await me(fetchOf(res(401, { error: "device revoked" })))).toEqual({ kind: "revoked" })
  })

  it("prompts returns the list, an empty list, and auth failures", async () => {
    expect(await prompts(fetchOf(res(200, { prompts: [] })))).toEqual({ kind: "ok", prompts: [] })
    expect(await prompts(fetchOf(res(401, { error: "device revoked" })))).toEqual({ kind: "revoked" })
    expect(await prompts(fetchOf(new Error("x")))).toEqual({ kind: "offline" })
  })
})

describe("answer", () => {
  it("posts promptId, bind and decision once", async () => {
    const f = fetchOf(res(200, { ok: true }))
    expect(await answer("p1", "b1", "allow", f)).toEqual({ kind: "ok" })
    const [, init] = (f as any).mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ promptId: "p1", bind: "b1", decision: "allow" })
    expect((f as any).mock.calls).toHaveLength(1)
  })

  it("maps 409 reasons, unknown reasons to gone, 401, 400 and network failure", async () => {
    expect(await answer("p", "b", "deny", fetchOf(res(409, { error: "e", reason: "terminal" })))).toEqual({ kind: "refused", reason: "terminal" })
    expect(await answer("p", "b", "deny", fetchOf(res(409, { error: "e", reason: "???" })))).toEqual({ kind: "refused", reason: "gone" })
    expect(await answer("p", "b", "deny", fetchOf(res(401, { error: "device revoked" })))).toEqual({ kind: "revoked" })
    expect(await answer("p", "b", "deny", fetchOf(res(400, { error: "bad" })))).toEqual({ kind: "offline" })
    expect(await answer("p", "b", "deny", fetchOf(new TypeError("net")))).toEqual({ kind: "offline" })
  })

  it("a request that hangs past the client timeout counts as offline", async () => {
    vi.useFakeTimers()
    const f = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_, rej) => init.signal!.addEventListener("abort", () => rej(new Error("aborted"))))) as any
    const p = answer("p", "b", "allow", f, 10_000)
    await vi.advanceTimersByTimeAsync(10_001)
    expect(await p).toEqual({ kind: "offline" })
  })
})

describe("setRemoteEnabled", () => {
  it("returns the status on 200 and the error string verbatim otherwise", async () => {
    const status = { enabled: true }
    expect(await setRemoteEnabled(true, fetchOf(res(200, status)))).toEqual({ ok: true, status })
    expect(await setRemoteEnabled(true, fetchOf(res(422, { error: "remote.host is not set (config.json)", key: "remote.host" })))).toEqual({ ok: false, error: "remote.host is not set (config.json)" })
    const f = fetchOf(res(200, {}))
    await setRemoteEnabled(false, f)
    const [url, init] = (f as any).mock.calls[0]
    expect(url).toBe("/api/remote/enabled")
    expect(init.headers["Content-Type"]).toBe("application/json")
    expect(JSON.parse(init.body)).toEqual({ enabled: false })
  })
})

describe("events and useOnline", () => {
  it("connects to the relative events url and reports named events", () => {
    const seen: string[] = []
    const close = connectRemoteEvents((e) => seen.push(e), make)
    expect(FakeES.last.url).toBe("/api/remote/events")
    FakeES.last.emit("heartbeat")
    FakeES.last.emit("changed")
    expect(seen).toEqual(["heartbeat", "changed"])
    close()
    expect(FakeES.last.closed).toBe(true)
  })

  function Probe({ onChanged }: { onChanged?: () => void }) {
    const online = useOnline(onChanged, make)
    return <span data-testid="o">{String(online)}</span>
  }
  const text = () => document.querySelector("[data-testid=o]")!.textContent

  it("goes offline after the stream is silent for more than 5 s, and back on an event", async () => {
    vi.useFakeTimers()
    const changed = vi.fn()
    render(<Probe onChanged={changed} />)
    expect(text()).toBe("true")
    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    expect(text()).toBe("true")
    await act(async () => { await vi.advanceTimersByTimeAsync(2500) })
    expect(text()).toBe("false")
    await act(async () => { FakeES.last.emit("heartbeat"); await vi.advanceTimersByTimeAsync(1100) })
    expect(text()).toBe("true")
    act(() => FakeES.last.emit("changed"))
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it("coming back to the foreground opens a fresh stream and re-fetches (iOS kills it in the background)", async () => {
    vi.useFakeTimers()
    const changed = vi.fn()
    render(<Probe onChanged={changed} />)
    const first = FakeES.last
    await act(async () => { await vi.advanceTimersByTimeAsync(9000) })
    expect(text()).toBe("false")
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")) })
    expect(first.closed).toBe(true)
    expect(FakeES.last).not.toBe(first)
    expect(changed).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(1100) })
    expect(text()).toBe("true")
  })

  it("is offline while navigator.onLine is false", async () => {
    render(<Probe />)
    await act(async () => { window.dispatchEvent(new Event("offline")) })
    expect(text()).toBe("false")
    await act(async () => { window.dispatchEvent(new Event("online")) })
    expect(text()).toBe("true")
  })
})
