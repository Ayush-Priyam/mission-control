import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import * as c from "../src/remote/contract.mjs"

test("contract module stays browser-safe (no node: imports)", () => {
  const src = readFileSync(new URL("../src/remote/contract.mjs", import.meta.url), "utf8")
  assert.doesNotMatch(src, /from\s+["']node:|import\(["']node:/)
})

test("exact strings and values from contract.md", () => {
  assert.equal(c.DEVICE_COOKIE, "__Host-mc_device")
  assert.equal(c.DEVICE_COOKIE_MAX_AGE, 31536000)
  assert.deepEqual([...c.ANSWER_REASONS], ["changed", "answered", "terminal", "gone"])
  assert.deepEqual({ ...c.ERRORS }, {
    notPaired: "not paired",
    revoked: "device revoked",
    pairingInvalid: "pairing link expired or already used",
    tooManyAttempts: "too many attempts",
  })
  assert.deepEqual([...c.REMOTE_EVENTS], ["changed", "heartbeat"])
  assert.ok(c.HEARTBEAT_SECONDS <= 3)
  assert.deepEqual({ ...c.REMOTE_DEFAULTS }, { enabled: false, port: 4330, waitSeconds: 120 })
  assert.equal(c.WAIT_SECONDS_MIN, 10)
  assert.equal(c.WAIT_SECONDS_MAX, 600)
  assert.equal(c.SERVER_STALE_MS, 6000)
  assert.equal(c.SERVER_HEARTBEAT_MS, 2000)
  assert.equal(c.PAIRING_TTL_MS, 600000)
  assert.equal(c.PAIR_FAILS_PER_MINUTE, 10)
  assert.deepEqual([...c.REMOTE_API_PATHS], ["pair", "me", "prompts", "events", "answer"].map((p) => `/api/remote/${p}`))
  assert.deepEqual(c.DASHBOARD_REMOTE_ROUTES.map((r) => `${r.method} ${r.path}`), ["GET /api/remote/status", "POST /api/remote/enabled"])
})

test("contract constants are frozen", () => {
  for (const v of [c.ANSWER_REASONS, c.ERRORS, c.REMOTE_EVENTS, c.REMOTE_DEFAULTS, c.REMOTE_API_PATHS, c.DASHBOARD_REMOTE_ROUTES]) assert.ok(Object.isFrozen(v))
})
