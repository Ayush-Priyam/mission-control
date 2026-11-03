import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Client for the remote-answering API (contract C10–C19, C44). Phone calls are relative and same-origin only;
 * device auth is the HttpOnly cookie, so nothing here touches document.cookie or web storage.
 * An answer POST is sent once and never retried (C22).
 */

export type Device = { id: string; label: string }
export type Option = { label: string; description: string }
export type Question = { question: string; header: string; multiSelect: false; options: Option[] }
export type Entry = {
  source: string
  id: string
  title: string
  project?: string
  lane: string
  tool: string
  target: string
  since: string
  answerable: boolean
  promptId?: string
  bind?: string
  kind?: "permission" | "ask"
  questions?: Question[]
}
export type Decision = "allow" | "deny" | { answers: Record<string, string> }
export type Reason = "changed" | "answered" | "terminal" | "gone"

export type RemoteStatus = {
  enabled: boolean
  host: string | null
  remotePort: number | null
  waitSeconds: number
  devices: { id: string; label: string; pairedAt: string; lastSeenAt: string | null }[]
  pairing: { open: boolean; expiresAt: string | null }
}

/** A request that did not reach the server (or timed out, or was malformed: shown the same way, design.md). */
export type Offline = { kind: "offline" }
export type Auth = { kind: "not-paired" } | { kind: "revoked" }

export const ANSWER_TIMEOUT_MS = 10_000
export const OFFLINE_AFTER_MS = 5_000

/** The only place the four 409 texts live (C29). Any other reason reads as `gone`. */
export function reasonText(reason: string): string {
  switch (reason) {
    case "changed":
      return "prompt changed, nothing was approved"
    case "answered":
      return "already answered"
    case "terminal":
      return "answered in terminal"
    default:
      return "no longer waiting"
  }
}

export const OFFLINE_TEXT = "offline, can't answer"

type Fetch = typeof fetch

async function body(res: Response): Promise<any> {
  try {
    return await res.json()
  } catch {
    return {}
  }
}

/** 401 → which auth screen (by the exact error strings of C13). */
function authOf(b: any): Auth {
  return b?.error === "device revoked" ? { kind: "revoked" } : { kind: "not-paired" }
}

export type PairResult = { kind: "ok"; device: Device } | { kind: "expired" } | { kind: "limited" } | Offline

export async function pair(token: string, f: Fetch = fetch): Promise<PairResult> {
  try {
    const res = await f("/api/remote/pair", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
    if (res.status === 200) return { kind: "ok", device: (await body(res)).device }
    if (res.status === 429) return { kind: "limited" }
    if (res.status === 401) return { kind: "expired" }
    return { kind: "offline" }
  } catch {
    return { kind: "offline" }
  }
}

export type MeResult = { kind: "ok"; device: Device } | Auth | Offline

export async function me(f: Fetch = fetch): Promise<MeResult> {
  try {
    const res = await f("/api/remote/me", { credentials: "same-origin" })
    if (res.status === 200) return { kind: "ok", device: (await body(res)).device }
    if (res.status === 401) return authOf(await body(res))
    return { kind: "offline" }
  } catch {
    return { kind: "offline" }
  }
}

export type PromptsResult = { kind: "ok"; prompts: Entry[] } | Auth | Offline

export async function prompts(f: Fetch = fetch): Promise<PromptsResult> {
  try {
    const res = await f("/api/remote/prompts", { credentials: "same-origin" })
    if (res.status === 200) {
      const b = await body(res)
      return { kind: "ok", prompts: Array.isArray(b.prompts) ? b.prompts : [] }
    }
    if (res.status === 401) return authOf(await body(res))
    return { kind: "offline" }
  } catch {
    return { kind: "offline" }
  }
}

export type AnswerResult = { kind: "ok" } | { kind: "refused"; reason: Reason } | Auth | Offline

/** POST once. Network failure, the 10 s client timeout and a 400 all come back as `offline` (design.md). */
export async function answer(promptId: string, bind: string, decision: Decision, f: Fetch = fetch, timeoutMs = ANSWER_TIMEOUT_MS): Promise<AnswerResult> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await f("/api/remote/answer", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ promptId, bind, decision }),
      signal: ctl.signal,
    })
    if (res.status === 200) return { kind: "ok" }
    const b = await body(res)
    if (res.status === 409) {
      const r = ["changed", "answered", "terminal", "gone"].includes(b?.reason) ? (b.reason as Reason) : "gone"
      return { kind: "refused", reason: r }
    }
    if (res.status === 401) return authOf(b)
    return { kind: "offline" }
  } catch {
    return { kind: "offline" }
  } finally {
    clearTimeout(timer)
  }
}

export type RemoteEvent = "changed" | "heartbeat" | "open" | "error"

/** Open GET /api/remote/events. `changed` carries no data: the caller re-fetches prompts. Returns a closer. */
export function connectRemoteEvents(on: (e: RemoteEvent) => void, make?: (url: string) => EventSource): () => void {
  let es: EventSource
  try {
    if (!make && typeof EventSource === "undefined") return () => {}
    es = (make ?? ((u: string) => new EventSource(u)))("/api/remote/events")
  } catch {
    return () => {}
  }
  es.addEventListener("open", () => on("open"))
  es.addEventListener("error", () => on("error"))
  es.addEventListener("heartbeat", () => on("heartbeat"))
  es.addEventListener("changed", () => on("changed"))
  return () => es.close()
}

/**
 * Opens the event stream and reports whether the phone can answer. Offline while `navigator.onLine` is
 * false, or while the stream has had no sign of life (events, open) for more than 5 s (error or silence, C30).
 * `onChanged` runs on every `changed` event.
 */
export function useOnline(onChanged?: () => void, make?: (url: string) => EventSource): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine !== false))
  const [streamUp, setStreamUp] = useState(true)
  const last = useRef(Date.now())
  const cb = useRef(onChanged)
  cb.current = onChanged

  useEffect(() => {
    let close = () => {}
    const connect = () => {
      close()
      last.current = Date.now()
      close = connectRemoteEvents((e) => {
        if (e === "error") return // down is judged by silence, so a quick reconnect does not flicker
        last.current = Date.now()
        setStreamUp(true)
        if (e === "changed") cb.current?.()
      }, make)
    }
    connect()
    const tick = setInterval(() => setStreamUp(Date.now() - last.current <= OFFLINE_AFTER_MS), 1000)
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    // iOS freezes a Home Screen app in the background and its stream dies without reconnecting: coming back
    // (opening it from a notification, say) opens a fresh stream and re-fetches at once.
    const back = () => {
      if (document.visibilityState !== "visible") return
      connect()
      setStreamUp(true)
      cb.current?.()
    }
    window.addEventListener("online", on)
    window.addEventListener("offline", off)
    document.addEventListener("visibilitychange", back)
    window.addEventListener("pageshow", back)
    return () => {
      close()
      clearInterval(tick)
      window.removeEventListener("online", on)
      window.removeEventListener("offline", off)
      document.removeEventListener("visibilitychange", back)
      window.removeEventListener("pageshow", back)
    }
  }, [make])

  return online && streamUp
}

// ---- desktop (read-only page, one write: the switch) ----

export async function getRemoteStatus(f: Fetch = fetch): Promise<RemoteStatus> {
  const res = await f("/api/remote/status", { credentials: "same-origin" })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as RemoteStatus
}

export type EnabledResult = { ok: true; status: RemoteStatus } | { ok: false; error: string }

/** The one write route on :4319 (C38). Never optimistic: the caller shows the returned `enabled`. */
export async function setRemoteEnabled(enabled: boolean, f: Fetch = fetch): Promise<EnabledResult> {
  try {
    const res = await f("/api/remote/enabled", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    })
    const b = await body(res)
    if (res.ok) return { ok: true, status: b as RemoteStatus }
    return { ok: false, error: typeof b?.error === "string" ? b.error : `HTTP ${res.status}` }
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) }
  }
}

/** GET /api/remote/status every `pollMs` while the page is visible (C44). `refresh` fetches now. */
export function useRemoteStatus(pollMs = 3000, f?: Fetch): { status: RemoteStatus | null; error: string | null; refresh: () => void; set: (s: RemoteStatus) => void } {
  const [status, set] = useState<RemoteStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setTick((n) => n + 1), [])
  useEffect(() => {
    let dead = false
    const load = () => {
      if (document.hidden) return
      getRemoteStatus(f).then(
        (s) => !dead && (set(s), setError(null)),
        (e) => !dead && setError(String(e?.message ?? e)),
      )
    }
    load()
    const t = setInterval(load, pollMs)
    document.addEventListener("visibilitychange", load)
    return () => {
      dead = true
      clearInterval(t)
      document.removeEventListener("visibilitychange", load)
    }
  }, [pollMs, tick, f])
  return { status, error, refresh, set }
}
