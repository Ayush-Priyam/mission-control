// Web Push: VAPID signing, the push-service allow-list, pings without payload, and once-per-prompt.
import { test } from "node:test"
import assert from "node:assert/strict"
import { createPublicKey, verify } from "node:crypto"
import { mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createNewPromptWatch, loadVapid, ping, readSubscriptions, setSubscription, validSubscription, vapidAuth } from "../src/remote/push.mjs"

const dir = () => mkdtempSync(join(tmpdir(), "mc-push-"))
const APPLE = "https://web.push.apple.com/QGxyz123"

test("VAPID: a stable key pair (0600) and an ES256 JWT that verifies against the public key", () => {
  const d = dir()
  try {
    const v = loadVapid(d)
    assert.deepEqual(loadVapid(d), v)
    assert.equal(statSync(join(d, "vapid.json")).mode & 0o777, 0o600)
    const raw = Buffer.from(v.publicKey, "base64url")
    assert.equal(raw.length, 65)
    const h = vapidAuth(APPLE, v, Date.parse("2026-11-03T07:00:00Z"))
    const [, t, k] = h.match(/^vapid t=([^,]+), k=(.+)$/)
    assert.equal(k, v.publicKey)
    const [head, body, sig] = t.split(".")
    const claims = JSON.parse(Buffer.from(body, "base64url"))
    assert.equal(claims.aud, "https://web.push.apple.com")
    assert.match(claims.sub, /^https:\/\//)
    assert.equal(claims.exp, Date.parse("2026-11-03T07:00:00Z") / 1000 + 12 * 3600)
    const pub = createPublicKey({ key: { kty: "EC", crv: "P-256", x: raw.subarray(1, 33).toString("base64url"), y: raw.subarray(33).toString("base64url") }, format: "jwk" })
    assert.ok(verify("sha256", Buffer.from(`${head}.${body}`), { key: pub, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url")))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test("only https endpoints of known push services are accepted", () => {
  assert.deepEqual(validSubscription({ endpoint: APPLE }), { endpoint: APPLE })
  assert.ok(validSubscription({ endpoint: "https://fcm.googleapis.com/fcm/send/abc" }))
  for (const endpoint of ["http://web.push.apple.com/x", "https://127.0.0.1/x", "https://evil.example/push", "https://web.push.apple.com.evil.example/x", "not a url"]) {
    assert.equal(validSubscription({ endpoint }), null, endpoint)
  }
})

test("ping: no payload, VAPID header; 410 removes the subscription; revoked devices are skipped and removed", async () => {
  const d = dir()
  try {
    setSubscription(d, "phone", { endpoint: APPLE }, 0)
    setSubscription(d, "gone", { endpoint: "https://web.push.apple.com/old" }, 0)
    setSubscription(d, "revoked", { endpoint: "https://web.push.apple.com/r" }, 0)
    const calls = []
    const fetch = async (url, init) => { calls.push({ url, init }); return { status: url.endsWith("/old") ? 410 : 201, text: async () => "" } }
    assert.equal(await ping({ remoteDir: d, deviceIds: ["phone", "gone"], fetch }), 1)
    assert.deepEqual(calls.map((c) => c.url).sort(), [APPLE, "https://web.push.apple.com/old"])
    const c = calls.find((x) => x.url === APPLE)
    assert.equal(c.init.method, "POST")
    assert.equal(c.init.body, undefined)
    assert.equal(c.init.headers.Topic, undefined) // Apple: BadWebPushTopic
    assert.match(c.init.headers.Authorization, /^vapid t=.+, k=/)
    assert.deepEqual(Object.keys(readSubscriptions(d)), ["phone"])
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test("a new prompt pings once; prompts already waiting at start do not", () => {
  let n = 0
  const watch = createNewPromptWatch(() => n++)
  watch(["old"])
  assert.equal(n, 0)
  watch(["old", "p1"])
  watch(["old", "p1"])
  assert.equal(n, 1)
  watch(["p1", "p2", "p3"])
  assert.equal(n, 2)
  watch([])
  watch(["p1"])
  assert.equal(n, 3)
})
