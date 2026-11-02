import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createWindowConfig, dur, forecastWindow, parseWindow } from "../src/forecast.mjs"

const T0 = Date.parse("2026-11-02T08:00:00Z")
const bk = (minAfter, tokens, cost = 0) => ({ b: new Date(T0 + minAfter * 60000).toISOString().slice(0, 16), in: tokens, out: 0, cacheRead: 0, cacheWrite: 0, cost })

test("window config: 5 h default; owner's hours and limits; junk ignored", () => {
  assert.deepEqual(parseWindow(null), { hours: 5 })
  assert.deepEqual(parseWindow({ usageWindow: { hours: 3, limitTokens: 1e6, limitUsd: -2 } }), { hours: 3, limitTokens: 1e6 })
  const dir = mkdtempSync(join(tmpdir(), "mc-win-"))
  const p = join(dir, "config.json")
  writeFileSync(p, JSON.stringify({ usageWindow: { limitUsd: 20 } }))
  assert.deepEqual(createWindowConfig(p).get(), { hours: 5, limitUsd: 20 })
  assert.deepEqual(createWindowConfig(null).get(), { hours: 5 })
})

test("forecast: the window opens at the first activity after the last one ended; ETA at the current rate", () => {
  // old window at T0-6h, a new one opens at T0; now = T0 + 1h, 100k tokens used -> 100k/h
  const buckets = [bk(-360, 50_000), bk(0, 40_000, 1), bk(30, 60_000, 1)]
  const now = T0 + 60 * 60000
  const f = forecastWindow(buckets, { now, hours: 5, limitTokens: 266_000 })
  assert.equal(f.start, "2026-11-02T08:00:00.000Z")
  assert.equal(f.resetsAt, "2026-11-02T13:00:00.000Z")
  assert.equal(f.used.tokens, 100_000)
  assert.equal(Math.round(f.rate.tokensPerHour), 100_000)
  assert.equal(Math.round(f.eta / 60000), 100)
  assert.equal(f.hitsBeforeReset, true)
  assert.equal(f.message, "At this rate you hit the limit in ~1h 40m")
})

test("forecast: no limit set, under the limit, over the limit, no window open", () => {
  const now = T0 + 60 * 60000
  const b = [bk(0, 100_000, 2)]
  assert.equal(forecastWindow(b, { now }).message, "No limit set · window resets in ~4h 00m")
  assert.equal(forecastWindow(b, { now, limitTokens: 10e6 }).hitsBeforeReset, false)
  assert.match(forecastWindow(b, { now, limitTokens: 10e6 }).message, /stay under the limit/)
  assert.equal(forecastWindow(b, { now, limitUsd: 1 }).message, "Over your limit for this window (estimate)")
  const old = forecastWindow(b, { now: T0 + 6 * 3600_000 })
  assert.equal(old.active, false)
  assert.equal(forecastWindow([], { now }).active, false)
  assert.equal(dur(25 * 60000), "25m")
})
