// Web Push for paired phones (opt-in per device: the phone's "Turn on notifications" button). A ping
// carries no payload, so the push service (Apple, Google, Mozilla) learns only that something is
// waiting; the phone's service worker then fetches the prompt from this server over the tailnet.
// VAPID (RFC 8292) is signed with node:crypto; no dependency, and no payload encryption is needed.
// This is the only outbound connection Mission Control makes, and only once a device subscribed.
import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto"
import { join } from "node:path"
import { readJson, writeJsonAtomic } from "./state.mjs"

// Push services a subscription may point at; anything else is refused (no server-side request forgery).
const PUSH_HOSTS = [/^web\.push\.apple\.com$/, /(^|\.)push\.apple\.com$/, /^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/]
// RFC 8292 wants a contact; the project page is a valid https one and names no person.
const SUBJECT = "https://github.com/aldefy/mission-control"

const b64url = (buf) => Buffer.from(buf).toString("base64url")
const vapidPath = (remoteDir) => join(remoteDir, "vapid.json")
const subsPath = (remoteDir) => join(remoteDir, "push.json")

/** This server's VAPID key pair, created once (0600). publicKey: the raw P-256 point, base64url. */
export function loadVapid(remoteDir) {
  const have = readJson(vapidPath(remoteDir))
  if (have?.publicKey && have?.privateJwk) return have
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" })
  const pub = publicKey.export({ format: "jwk" })
  const v = { publicKey: b64url(Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, "base64url"), Buffer.from(pub.y, "base64url")])), privateJwk: privateKey.export({ format: "jwk" }) }
  writeJsonAtomic(vapidPath(remoteDir), v)
  return v
}

/** The Authorization header for one push service: `vapid t=<ES256 JWT>, k=<public key>`. */
export function vapidAuth(endpoint, vapid, nowMs) {
  const aud = new URL(endpoint).origin
  const head = b64url(JSON.stringify({ typ: "JWT", alg: "ES256" }))
  const body = b64url(JSON.stringify({ aud, exp: Math.floor(nowMs / 1000) + 12 * 3600, sub: SUBJECT }))
  const sig = sign("sha256", Buffer.from(`${head}.${body}`), { key: createPrivateKey({ key: vapid.privateJwk, format: "jwk" }), dsaEncoding: "ieee-p1363" })
  return `vapid t=${head}.${body}.${b64url(sig)}, k=${vapid.publicKey}`
}

/** A subscription the server will use, or null: https, a known push service, the browser's key shapes. */
export function validSubscription(s) {
  if (!s || typeof s !== "object" || typeof s.endpoint !== "string" || s.endpoint.length > 1000) return null
  let u
  try { u = new URL(s.endpoint) } catch { return null }
  if (u.protocol !== "https:" || !PUSH_HOSTS.some((r) => r.test(u.hostname))) return null
  return { endpoint: u.href }
}

export function readSubscriptions(remoteDir) {
  const v = readJson(subsPath(remoteDir))
  return v && typeof v === "object" && !Array.isArray(v) ? v : {}
}

/** One subscription per device (a new one replaces it); null removes it. */
export function setSubscription(remoteDir, deviceId, sub, nowMs) {
  const all = readSubscriptions(remoteDir)
  if (sub) all[deviceId] = { ...sub, at: new Date(nowMs).toISOString() }
  else delete all[deviceId]
  writeJsonAtomic(subsPath(remoteDir), all)
}

/**
 * Ping every subscribed device that is still paired. A push service answering 404 or 410 means the
 * subscription is gone: it is removed. Resolves with the number of pings accepted.
 */
export async function ping({ remoteDir, deviceIds, fetch = globalThis.fetch, now = () => Date.now() }) {
  const subs = readSubscriptions(remoteDir)
  const live = new Set(deviceIds)
  const vapid = loadVapid(remoteDir)
  let sent = 0
  for (const [id, s] of Object.entries(subs)) {
    if (!live.has(id) || !validSubscription(s)) { setSubscription(remoteDir, id, null, now()); continue }
    try {
      const r = await fetch(s.endpoint, { method: "POST", headers: { TTL: "120", Urgency: "high", Topic: "needs-you", Authorization: vapidAuth(s.endpoint, vapid, now()), "Content-Length": "0" }, signal: AbortSignal.timeout(10_000) })
      if (r.status === 404 || r.status === 410) setSubscription(remoteDir, id, null, now())
      else if (r.status < 300) sent++
      else console.error(`mission control: push to ${new URL(s.endpoint).hostname} refused (${r.status})`)
    } catch (e) {
      console.error(`mission control: push failed: ${e?.message ?? e}`)
    }
  }
  return sent
}

/** Calls `onNew()` once per prompt id it has not seen before; ids that disappear are forgotten. */
export function createNewPromptWatch(onNew) {
  let seen = null
  return (ids) => {
    const now = new Set(ids)
    // The first look only learns what is already waiting: a restart does not ping old prompts.
    if (seen && [...now].some((id) => !seen.has(id))) onNew()
    seen = now
  }
}
