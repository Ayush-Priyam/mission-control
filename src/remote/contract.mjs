// Shared v2.3 remote-answering contract (specs/001-mission-control-v2-3-answer/contract.md).
// Constants only: no logic, no `node:` imports, so the web page may import it like
// src/names.mjs and src/trace.mjs. Types live in contract.d.mts.

/** Cookie that carries `<deviceId>.<secret>` (C11). */
export const DEVICE_COOKIE = "__Host-mc_device"
/** Cookie lifetime in seconds (C11). */
export const DEVICE_COOKIE_MAX_AGE = 31536000

/** 409 refusal reasons for POST /api/remote/answer (C17, FR-14). */
export const ANSWER_REASONS = Object.freeze(["changed", "answered", "terminal", "gone"])

/** Exact 401/429 error strings the frontend matches on (C11, C13). */
export const ERRORS = Object.freeze({
  notPaired: "not paired",
  revoked: "device revoked",
  pairingInvalid: "pairing link expired or already used",
  tooManyAttempts: "too many attempts",
})

/** Named SSE events on /api/remote/events; data is always `{}` (C18). */
export const REMOTE_EVENTS = Object.freeze(["changed", "heartbeat"])
/** Max seconds between heartbeats (C18). */
export const HEARTBEAT_SECONDS = 3

/** Remote config defaults and bounds (C36). */
export const REMOTE_DEFAULTS = Object.freeze({ enabled: false, port: 4330, waitSeconds: 120 })
export const WAIT_SECONDS_MIN = 10
export const WAIT_SECONDS_MAX = 600

/** server.json heartbeat interval and staleness limit, in ms (C33, C41). */
export const SERVER_HEARTBEAT_MS = 2000
export const SERVER_STALE_MS = 6000

/** Pairing token lifetime in ms, and the failed-attempt limit per minute (T3, C11). */
export const PAIRING_TTL_MS = 10 * 60 * 1000
export const PAIR_FAILS_PER_MINUTE = 10

/** Paths the remote listener serves; everything else is 404 (C5). */
export const REMOTE_API_PATHS = Object.freeze([
  "/api/remote/pair",
  "/api/remote/me",
  "/api/remote/prompts",
  "/api/remote/events",
  "/api/remote/answer",
])
/** The only remote routes on :4319 (C9). */
export const DASHBOARD_REMOTE_ROUTES = Object.freeze([
  { method: "GET", path: "/api/remote/status" },
  { method: "POST", path: "/api/remote/enabled" },
])
