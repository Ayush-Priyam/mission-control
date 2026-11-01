import { useCallback, useEffect, useReducer, useState } from "react"

export type Capabilities = { adapter: string; extras: string[]; actions: string[]; source: string | null }
export type RunSummary = {
  id: string
  idea: string
  repo?: string
  live: boolean
  /** The run's current stop is an owner stop (src/status.mjs). */
  waiting?: boolean
  stages: Record<string, { status: string; rounds?: number }>
  harness?: string
}
export type RunDetail = { state: Record<string, any>; events: Record<string, any>[]; live: boolean }

export type Remote<T> = { data: T | null; error: string | null; loading: boolean; reload: () => void }

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url}: ${r.status}`)
  return r.json()
}

export type FetchState<T> = { url: string | null; data: T | null; error: string | null; loading: boolean }
export type FetchAction<T> =
  | { type: "reset"; url: string | null }
  | { type: "ok"; url: string; data: T }
  | { type: "fail"; url: string; error: string }

export const initialFetch = <T,>(url: string | null): FetchState<T> => ({
  url,
  data: null,
  error: null,
  loading: url !== null,
})

/** State for `url`. Anything recorded for a different url is discarded; a poll on the same url keeps data. */
export function fetchReducer<T>(state: FetchState<T>, action: FetchAction<T>): FetchState<T> {
  if (action.type === "reset") return action.url === state.url ? state : initialFetch<T>(action.url)
  if (action.url !== state.url) return state
  if (action.type === "ok") return { url: state.url, data: action.data, error: null, loading: false }
  return { ...state, error: action.error, loading: false }
}

/** `refresh`: any value; when it changes the url is fetched again (data kept until the answer). */
function useFetch<T>(url: string | null, pollMs = 0, refresh: unknown = 0): Remote<T> {
  const [raw, dispatch] = useReducer(fetchReducer<T>, url, initialFetch<T>)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((n) => n + 1), [])
  // never expose results recorded for a previous url
  const state = raw.url === url ? raw : initialFetch<T>(url)

  useEffect(() => {
    dispatch({ type: "reset", url })
    if (url === null) return
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | undefined
    const load = () =>
      getJson<T>(url).then(
        (data) => !cancelled && dispatch({ type: "ok", url, data }),
        (e) => !cancelled && dispatch({ type: "fail", url, error: String(e.message ?? e) }),
      )
    const start = () => {
      if (pollMs && timer === undefined) timer = setInterval(load, pollMs)
    }
    const stop = () => {
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
    }
    const onVis = () => {
      if (document.hidden) stop()
      else {
        load()
        start()
      }
    }
    load()
    if (!document.hidden) start()
    if (pollMs) document.addEventListener("visibilitychange", onVis)
    return () => {
      cancelled = true
      stop()
      document.removeEventListener("visibilitychange", onVis)
    }
  }, [url, pollMs, tick, refresh])

  return { data: state.data, error: state.error, loading: state.loading, reload }
}

const POLL = 2000

export const useCapabilities = () => useFetch<Capabilities>("/api/capabilities")
export const useRuns = () => useFetch<RunSummary[]>("/api/runs", POLL)
export const useRun = (id: string | null) =>
  useFetch<RunDetail>(id ? `/api/run/${encodeURIComponent(id)}` : null, POLL)
/** A session transcript by file name (`name` null: nothing to load). */
export const useSession = (id: string, name: string | null) =>
  useFetch<{ text: string; truncated?: boolean }>(
    name ? `/api/run/${encodeURIComponent(id)}/session/${encodeURIComponent(name)}` : null,
  )
export const useCrew = (repo?: string) =>
  useFetch<any>(`/api/crew${repo ? `?repo=${encodeURIComponent(repo)}` : ""}`)
/** An adapter extra. `refresh` reloads it when it changes; run-scoped extras pass `runChanges(events)`. */
export function useExtra<T>(key: string, id?: string | null, query?: Record<string, string>, refresh: unknown = 0) {
  const qs = query ? `?${new URLSearchParams(query)}` : ""
  return useFetch<T>(`/api/x/${encodeURIComponent(key)}${id ? `/${encodeURIComponent(id)}` : ""}${qs}`, 0, refresh)
}

export async function postAction(id: string, name: string, body: object = {}) {
  const r = await fetch(`/api/run/${encodeURIComponent(id)}/action/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error ?? j.message ?? `action ${name}: ${r.status}`)
  return j
}
