import { useEffect, useState, useSyncExternalStore } from "react"

/**
 * When the page last heard from the server. Every loader reports here: any good answer (a 304 or an
 * identical body included) is a sign of life; a failure is not. The header shows "live · Ns" until
 * nothing has come back for STALE_MS, then "stale · Ns" and the page stops its pulses.
 */
export const STALE_MS = 15_000

let lastOk = 0
let lastFail = 0
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

export function markOk(t = Date.now()) {
  lastOk = t
  emit()
}
export function markFail(t = Date.now()) {
  lastFail = t
  emit()
}
/** The last good answer and the last failure (ms; 0: never). */
export const lastSeen = () => ({ ok: lastOk, fail: lastFail })
/** Tests only. */
export function resetFreshness() {
  lastOk = 0
  lastFail = 0
  emit()
}
const subscribe = (f: () => void) => {
  subs.add(f)
  return () => subs.delete(f)
}
const snapshot = () => `${lastOk}|${lastFail}`

export type Freshness = { state: "connecting" | "live" | "stale"; ageS: number }

/** The freshness at `now`: connecting before the first answer, stale once the last good one is older than `staleMs`. */
export function freshness(now: number, ok: number, fail: number, staleMs = STALE_MS): Freshness {
  if (!ok) return { state: fail ? "stale" : "connecting", ageS: 0 }
  const ageS = Math.max(0, Math.floor((now - ok) / 1000))
  return { state: now - ok > staleMs ? "stale" : "live", ageS }
}

/** The page's freshness, ticking each second; while stale, `<html data-stale>` stops every pulse. */
export function useFreshness(): Freshness {
  const snap = useSyncExternalStore(subscribe, snapshot, snapshot)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const [ok, fail] = snap.split("|").map(Number)
  const f = freshness(Math.max(now, ok), ok, fail)
  useEffect(() => {
    document.documentElement.toggleAttribute("data-stale", f.state === "stale")
  }, [f.state])
  return f
}
