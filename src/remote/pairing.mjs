// Pairing tokens and paired devices (spec FR-6–FR-9, contract C11, C13, C23).
// Only SHA-256 hashes of tokens and device secrets are stored; the raw values exist once, in the
// pairing URL and in the device's HttpOnly cookie.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { join } from "node:path"
import { DEVICE_COOKIE, DEVICE_COOKIE_MAX_AGE, PAIR_FAILS_PER_MINUTE, PAIRING_TTL_MS } from "./contract.mjs"
import { readJson, writeJsonAtomic } from "./state.mjs"

const sha256 = (s) => createHash("sha256").update(String(s)).digest("hex")
const pairingFile = (dir) => join(dir, "pairing.json")
const devicesFile = (dir) => join(dir, "devices.json")
const iso = (ms) => new Date(ms).toISOString()
const B64URL = /^[A-Za-z0-9_-]+$/
const DEVICE_ID = /^[A-Za-z0-9_-]{8,64}$/

/** Equal-length hex digests compared in constant time. */
function sameHash(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"))
}

/**
 * A new pairing token (FR-6): 32 random bytes, base64url. Only its hash is stored, with a 10-minute expiry;
 * it replaces any earlier token. `host` builds the URL; the token sits in the fragment, so it never
 * reaches a server log.
 */
export function createPairingToken({ remoteDir, host, now = Date.now() }) {
  const token = randomBytes(32).toString("base64url")
  const expiresAt = iso(now + PAIRING_TTL_MS)
  writeJsonAtomic(pairingFile(remoteDir), { tokenHash: sha256(token), expiresAt, usedAt: null })
  return { token, url: `https://${host}/pair#t=${token}`, expiresAt }
}

/** {open, expiresAt}: whether an unused, unexpired token is waiting (no token material). */
export function pairingStatus({ remoteDir, now = Date.now() }) {
  const p = remoteDir ? readJson(pairingFile(remoteDir)) : null
  const exp = Date.parse(p?.expiresAt)
  const open = !!p && !p.usedAt && Number.isFinite(exp) && exp > now
  return { open, expiresAt: open ? p.expiresAt : null }
}

/** A short device label from the user agent (40 characters at most, printable only). */
export function labelFromUa(ua) {
  const s = String(ua ?? "")
  const known = [
    [/iPhone/, "iPhone"], [/iPad/, "iPad"], [/Android/, "Android"],
    [/Macintosh|Mac OS X/, "Mac"], [/Windows/, "Windows"], [/Linux/, "Linux"],
  ].find(([re]) => re.test(s))?.[1]
  const browser = [
    [/EdgiOS|Edg\//, "Edge"], [/CriOS|Chrome\//, "Chrome"], [/FxiOS|Firefox\//, "Firefox"], [/Safari\//, "Safari"],
  ].find(([re]) => re.test(s))?.[1]
  const label = known ? (browser ? `${known} ${browser}` : known) : s.replace(/[^\x20-\x7e]/g, "").trim()
  return (label || "device").slice(0, 40)
}

function readDevices(remoteDir) {
  const d = readJson(devicesFile(remoteDir))
  return Array.isArray(d?.devices) ? d.devices.filter((x) => x && typeof x.id === "string") : []
}

/**
 * Redeem a pairing token (FR-7): only a matching, unexpired, unused token works, and it is marked used.
 * Creates a device and returns { device: {id, label}, cookie } (cookie = the Set-Cookie value), or null.
 */
export function redeemToken({ remoteDir, token, ua, now = Date.now() }) {
  if (typeof token !== "string" || token.length > 128 || !B64URL.test(token)) return null
  const p = readJson(pairingFile(remoteDir))
  if (!p || p.usedAt || !(Date.parse(p.expiresAt) > now) || !sameHash(sha256(token), p.tokenHash)) return null
  // Mark used before the device exists: a crash in between costs a re-pair, never a second use.
  writeJsonAtomic(pairingFile(remoteDir), { ...p, usedAt: iso(now) })
  const id = randomBytes(9).toString("base64url")
  const secret = randomBytes(32).toString("base64url")
  const device = { id, label: labelFromUa(ua), secretHash: sha256(secret), pairedAt: iso(now) }
  // Re-read just before writing: a CLI revoke may have landed meanwhile.
  writeJsonAtomic(devicesFile(remoteDir), { devices: [...readDevices(remoteDir), device] })
  return { device: { id, label: device.label }, cookie: cookieHeader(id, secret) }
}

/** Paired (not revoked) devices: [{id, label, pairedAt}] (no hash material). */
export function listDevices({ remoteDir }) {
  if (!remoteDir) return []
  return readDevices(remoteDir).filter((d) => !d.revokedAt).map((d) => ({ id: d.id, label: d.label, pairedAt: d.pairedAt }))
}

/**
 * Revoke a paired device (FR-9). The record stays with `revokedAt`, so its cookie gets "device revoked"
 * (and is cleared) rather than "not paired". Returns the revoked {id, label, pairedAt}, or null when no
 * paired device has that id.
 */
export function revokeDevice({ remoteDir, id, now = Date.now() }) {
  const all = readDevices(remoteDir)
  const d = all.find((x) => x.id === id && !x.revokedAt)
  if (!d) return null
  writeJsonAtomic(devicesFile(remoteDir), { devices: all.map((x) => (x === d ? { ...x, revokedAt: iso(now) } : x)) })
  return { id: d.id, label: d.label, pairedAt: d.pairedAt }
}

/** `<id>.<secret>` from a Cookie header, or null. */
export function parseCookie(header) {
  if (typeof header !== "string") return null
  for (const part of header.split(";")) {
    const eq = part.indexOf("=")
    if (eq < 0 || part.slice(0, eq).trim() !== DEVICE_COOKIE) continue
    const v = part.slice(eq + 1).trim()
    const dot = v.indexOf(".")
    if (dot < 1) return null
    const id = v.slice(0, dot), secret = v.slice(dot + 1)
    if (!DEVICE_ID.test(id) || !B64URL.test(secret) || secret.length > 128) return null
    return { id, secret }
  }
  return null
}

/**
 * The device a cookie belongs to (FR-8): {id, label, pairedAt}, "revoked", or null (missing, unknown or
 * wrong secret). devices.json is read on every call, so a CLI revoke applies to the next request.
 */
export function verifyDevice({ remoteDir, cookie }) {
  const c = typeof cookie === "string" ? parseCookie(cookie) : cookie
  if (!c) return null
  const d = readDevices(remoteDir).find((x) => x.id === c.id)
  if (!d || !sameHash(sha256(c.secret), d.secretHash)) return null
  if (d.revokedAt) return "revoked"
  return { id: d.id, label: d.label, pairedAt: d.pairedAt }
}

/** The Set-Cookie value for a paired device (C11). */
export const cookieHeader = (id, secret) =>
  `${DEVICE_COOKIE}=${id}.${secret}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${DEVICE_COOKIE_MAX_AGE}`

/** The Set-Cookie value that clears the device cookie (C13). */
export const clearCookieHeader = () => `${DEVICE_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`

/**
 * Failed pairing attempts in the last minute (FR-7): blocked() is true once 10 have failed, so the 11th
 * attempt gets 429 without being checked. In memory; a restart resets it.
 */
export function createPairLimiter({ now = () => Date.now(), limit = PAIR_FAILS_PER_MINUTE, windowMs = 60_000 } = {}) {
  let fails = []
  const prune = () => { const t = now(); fails = fails.filter((x) => t - x < windowMs) }
  return {
    blocked() { prune(); return fails.length >= limit },
    fail() { prune(); fails.push(now()) },
  }
}
