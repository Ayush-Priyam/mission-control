// Local fetch hooks for the Calls tab (v2 item API). To be folded into api.ts with the v2 hooks.
import { useEffect, useReducer } from "react"
import { fetchReducer, initialFetch } from "@/lib/api"

export type CallKind = "tool" | "mcp" | "skill" | "agent"
export type Call = {
  id: string
  lane: string
  ts: string
  name: string
  kind: CallKind
  server?: string
  summary: string
  input?: unknown
  ok?: boolean
  error?: string
  durationMs?: number
  result?: string
  /** Agent calls: the lane the sub-agent ran in, when known. */
  subLane?: string
}
export type Tokens = { in: number; out: number; cacheRead: number; cacheWrite: number }
export type Lane = {
  id: string
  label: string
  kind: "main" | "subagent" | "stage" | "crew"
  status: string
  model?: string
  reason?: string
  calls: number
  errors: number
  tokens?: Tokens
  cost?: number
  parent?: string
  startedAt?: string
  endedAt?: string
}
export type ItemDetail = {
  summary: { source: string; id: string; title: string; live: boolean; status: string; counts?: { lanes: number; calls: number; errors: number } }
  lanes: Lane[]
}

export type Remote<T> = { data: T | null; error: string | null; loading: boolean }

/** GET `url` (null: nothing), again every `pollMs` while the page is visible (0: once). */
function useJson<T>(url: string | null, pollMs = 0): Remote<T> {
  const [raw, dispatch] = useReducer(fetchReducer<T>, url, initialFetch<T>)
  const state = raw.url === url ? raw : initialFetch<T>(url)
  useEffect(() => {
    dispatch({ type: "reset", url })
    if (url === null) return
    let cancelled = false
    const load = async () => {
      try {
        const r = await fetch(url)
        if (!r.ok) throw new Error(`${url}: ${r.status}`)
        const data = (await r.json()) as T
        if (!cancelled) dispatch({ type: "ok", url, data })
      } catch (e) {
        if (!cancelled) dispatch({ type: "fail", url, error: String((e as Error)?.message ?? e) })
      }
    }
    load()
    const timer = pollMs ? setInterval(() => !document.hidden && load(), pollMs) : undefined
    return () => {
      cancelled = true
      if (timer !== undefined) clearInterval(timer)
    }
  }, [url, pollMs])
  return { data: state.data, error: state.error, loading: state.loading }
}

const base = (source: string, id: string) => `/api/item/${encodeURIComponent(source)}/${encodeURIComponent(id)}`

export const useItemDetail = (source: string, id: string, pollMs = 0) => useJson<ItemDetail>(base(source, id), pollMs)
/** Every call of the item; lane/kind/search filtering happens client-side so chip counts stay exact. */
export const useItemCalls = (source: string, id: string, pollMs = 0) => useJson<Call[]>(`${base(source, id)}/calls`, pollMs)
