import { describe, expect, it, vi } from "vitest"
import { createLoader } from "./api"

const answer = (status: number, text: string, etag: string | null = null) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => JSON.parse(text),
  text: async () => text,
  headers: new Headers(etag ? { etag } : {}),
})

describe("createLoader", () => {
  it("sends the last ETag and drops a 304", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) =>
      (init?.headers as Record<string, string> | undefined)?.["if-none-match"] === 'W/"a"' ? answer(304, "") : answer(200, '{"n":1}', 'W/"a"'),
    )
    const onData = vi.fn()
    const load = createLoader("/api/x", onData, () => {}, fetchImpl)
    await load()
    await load()
    expect(fetchImpl.mock.calls[0]).toEqual(["/api/x"])
    expect(fetchImpl.mock.calls[1]).toEqual(["/api/x", { headers: { "if-none-match": 'W/"a"' } }])
    expect(onData).toHaveBeenCalledTimes(1)
    expect(onData).toHaveBeenCalledWith({ n: 1 })
  })

  it("skips an identical body when the server sends no ETag, dispatches a changed one", async () => {
    const bodies = ['{"n":1}', '{"n":1}', '{"n":2}']
    const fetchImpl = vi.fn(async () => answer(200, bodies.shift()!))
    const onData = vi.fn()
    const load = createLoader("/api/x", onData, () => {}, fetchImpl)
    await load()
    await load()
    await load()
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(onData.mock.calls).toEqual([[{ n: 1 }], [{ n: 2 }]])
  })

  it("never overlaps: a poll while one is in flight is skipped", async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const fetchImpl = vi.fn(async () => {
      await gate
      return answer(200, '{"n":1}')
    })
    const onData = vi.fn()
    const load = createLoader("/api/x", onData, () => {}, fetchImpl)
    const first = load()
    await load()
    await load()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    release()
    await first
    expect(onData).toHaveBeenCalledTimes(1)
    await load() // free again once the first answered
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it("after an error, the next good answer dispatches even when unchanged (clears the error)", async () => {
    const answers = [answer(200, '{"n":1}', 'W/"a"'), answer(500, ""), answer(200, '{"n":1}', 'W/"a"')]
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) =>
      // a server would answer 304 to the old tag; the loader must not send it after a failure
      (init?.headers as Record<string, string> | undefined)?.["if-none-match"] && answers.length === 1 ? answer(304, "") : answers.shift()!,
    )
    const onData = vi.fn()
    const onError = vi.fn()
    const load = createLoader("/api/x", onData, onError, fetchImpl)
    await load()
    await load()
    await load()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onData.mock.calls).toEqual([[{ n: 1 }], [{ n: 1 }]])
    expect(fetchImpl.mock.calls[2]).toEqual(["/api/x"])
  })

  it("reports errors and stays usable", async () => {
    const fetchImpl = vi.fn(async () => answer(500, ""))
    const onError = vi.fn()
    const load = createLoader("/api/x", () => {}, onError, fetchImpl)
    await load()
    await load()
    expect(onError.mock.calls).toEqual([["/api/x: 500"], ["/api/x: 500"]])
  })
})
