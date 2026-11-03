import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clearCookieHeader, cookieHeader, createPairLimiter, createPairingToken, labelFromUa, listDevices, pairingStatus, parseCookie, redeemToken, revokeDevice, verifyDevice } from "../src/remote/pairing.mjs"

const dir = () => join(mkdtempSync(join(tmpdir(), "mc-home-")), ".mission-control", "remote")
const T = Date.parse("2026-11-03T10:00:00Z")
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"

test("token: 32 random bytes base64url in the URL fragment; only its SHA-256 on disk; 10-minute expiry", () => {
  const d = dir()
  const t = createPairingToken({ remoteDir: d, host: "a.ts.net", now: T })
  assert.match(t.token, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(t.url, `https://a.ts.net/pair#t=${t.token}`)
  assert.equal(t.expiresAt, new Date(T + 600_000).toISOString())
  for (const n of readdirSync(d)) assert.ok(!readFileSync(join(d, n), "utf8").includes(t.token), `raw token in ${n}`)
  assert.equal(statSync(join(d, "pairing.json")).mode & 0o777, 0o600)
  assert.deepEqual(pairingStatus({ remoteDir: d, now: T }), { open: true, expiresAt: t.expiresAt })
})

test("redeem: single use; second use, expired, unknown and malformed tokens refused", () => {
  const d = dir()
  const t = createPairingToken({ remoteDir: d, host: "a.ts.net", now: T })
  assert.equal(redeemToken({ remoteDir: d, token: "A".repeat(43), now: T }), null, "unknown")
  assert.equal(redeemToken({ remoteDir: d, token: "../../etc", now: T }), null, "malformed")
  assert.equal(redeemToken({ remoteDir: d, token: t.token, now: T + 600_001 }), null, "expired")
  const r = redeemToken({ remoteDir: d, token: t.token, ua: IPHONE, now: T + 1000 })
  assert.ok(r)
  assert.deepEqual(r.device.label, "iPhone Safari")
  assert.equal(redeemToken({ remoteDir: d, token: t.token, now: T + 2000 }), null, "second use")
  assert.equal(pairingStatus({ remoteDir: d, now: T + 2000 }).open, false)
  // a new token replaces an unused one
  const a = createPairingToken({ remoteDir: d, host: "a.ts.net", now: T })
  const b = createPairingToken({ remoteDir: d, host: "a.ts.net", now: T })
  assert.equal(redeemToken({ remoteDir: d, token: a.token, now: T }), null)
  assert.ok(redeemToken({ remoteDir: d, token: b.token, now: T }))
})

test("cookie: __Host- name, Path=/, Secure, HttpOnly, SameSite=Strict, one year; clear has Max-Age=0", () => {
  const d = dir()
  const t = createPairingToken({ remoteDir: d, host: "a.ts.net", now: T })
  const { cookie, device } = redeemToken({ remoteDir: d, token: t.token, now: T })
  const [pair, ...attrs] = cookie.split("; ")
  assert.match(pair, new RegExp(`^__Host-mc_device=${device.id}\\.[A-Za-z0-9_-]{43}$`))
  assert.deepEqual(attrs.sort(), ["HttpOnly", "Max-Age=31536000", "Path=/", "SameSite=Strict", "Secure"])
  assert.ok(!attrs.some((a) => a.startsWith("Domain")))
  const secret = pair.split(".")[1]
  for (const n of readdirSync(d)) assert.ok(!readFileSync(join(d, n), "utf8").includes(secret), `raw secret in ${n}`)
  assert.match(clearCookieHeader(), /^__Host-mc_device=; .*Max-Age=0/)
  assert.deepEqual(parseCookie(`a=b; ${pair}; c=d`), { id: device.id, secret })
  assert.equal(parseCookie("__Host-mc_device=nodot"), null)
  assert.equal(cookieHeader("id12345678", "s").startsWith("__Host-mc_device=id12345678.s; Path=/"), true)
})

test("verify: valid -> device; wrong secret or unknown -> null; revoke -> 'revoked' on the next verify", () => {
  const d = dir()
  const t = createPairingToken({ remoteDir: d, host: "a.ts.net", now: T })
  const { cookie, device } = redeemToken({ remoteDir: d, token: t.token, ua: "x", now: T })
  const header = cookie.split(";")[0]
  assert.equal(verifyDevice({ remoteDir: d, cookie: header }).id, device.id)
  assert.equal(verifyDevice({ remoteDir: d, cookie: header.slice(0, -2) + "zz" }), null)
  assert.equal(verifyDevice({ remoteDir: d, cookie: undefined }), null)
  assert.deepEqual(listDevices({ remoteDir: d }).map((x) => x.id), [device.id])
  assert.ok(!("secretHash" in listDevices({ remoteDir: d })[0]))
  assert.equal(revokeDevice({ remoteDir: d, id: "nope", now: T }), null)
  assert.equal(revokeDevice({ remoteDir: d, id: device.id, now: T }).id, device.id)
  assert.equal(verifyDevice({ remoteDir: d, cookie: header }), "revoked")
  assert.deepEqual(listDevices({ remoteDir: d }), [])
  assert.equal(revokeDevice({ remoteDir: d, id: device.id, now: T }), null, "already revoked")
})

test("limiter: 10 failures in a minute block the 11th attempt; a minute later it is open again", () => {
  let t = T
  const l = createPairLimiter({ now: () => t })
  for (let i = 0; i < 10; i++) { assert.equal(l.blocked(), false); l.fail() }
  assert.equal(l.blocked(), true)
  t += 60_001
  assert.equal(l.blocked(), false)
})

test("labelFromUa: short and printable", () => {
  assert.equal(labelFromUa(IPHONE), "iPhone Safari")
  assert.equal(labelFromUa("x".repeat(100)).length, 40)
  assert.equal(labelFromUa(""), "device")
})
