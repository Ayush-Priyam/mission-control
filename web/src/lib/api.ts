import { useCallback, useEffect, useRef, useState } from "react"

export type Capabilities = { adapter: string; extras: string[]; actions: string[] }
export type RunSummary = {
  id: string
  idea: string
  repo?: string
  live: boolean
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

function useFetch<T>(url: string | null, pollMs = 0): Remote<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(url !== null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((n) => n + 1), [])
  const urlRef = useRef(url)
  urlRef.current = url

  useEffect(() => {
    if (url === null) {
      setData(null)
      setLoading(false)
      return
    }
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | undefined
    setLoading(true)
    const load = () =>
      getJson<T>(url).then(
        (d) => {
          if (cancelled) return
          setData(d)
          setError(null)
          setLoading(false)
        },
        (e) => {
          if (cancelled) return
          setError(String(e.message ?? e))
          setLoading(false)
        },
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
  }, [url, pollMs, tick])

  return { data, error, loading, reload }
}

const POLL = 2000

export const useCapabilities = () => useFetch<Capabilities>("/api/capabilities")
export const useRuns = () => useFetch<RunSummary[]>("/api/runs", POLL)
export const useRun = (id: string | null) =>
  useFetch<RunDetail>(id ? `/api/run/${encodeURIComponent(id)}` : null, POLL)
export const useCrew = (repo?: string) =>
  useFetch<any>(`/api/crew${repo ? `?repo=${encodeURIComponent(repo)}` : ""}`)
export function useExtra<T>(key: string, id?: string | null, query?: Record<string, string>) {
  const qs = query ? `?${new URLSearchParams(query)}` : ""
  return useFetch<T>(`/api/x/${encodeURIComponent(key)}${id ? `/${encodeURIComponent(id)}` : ""}${qs}`)
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
