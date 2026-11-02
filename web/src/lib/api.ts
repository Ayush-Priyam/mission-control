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

// ---- v2: one set of routes for every source ----

export type Status = "working" | "waiting" | "stopped" | "failed" | "done" | "idle"
export type Tokens = { in: number; out: number; cacheRead: number; cacheWrite: number }
export type ItemSummary = {
  source: string
  id: string
  kind: "run" | "session"
  title: string
  harness: string
  cwd: string | null
  branch: string | null
  live: boolean
  status: Status
  waiting: boolean
  startedAt: string | null
  updatedAt: string | null
  counts: { lanes: number; calls: number; errors: number }
  tokens: Tokens
  cost: number
}
export type Lane = {
  id: string
  label: string
  kind: "main" | "subagent" | "stage" | "crew"
  status: Status
  model?: string
  nowDoing?: { name: string; kind: string; summary: string; ts: string }
  reason?: string
  calls: number
  errors: number
  tokens: Tokens
  cost: number
  parent?: string
  startedAt?: string
  endedAt?: string
}
export type Call = {
  id: string
  lane: string
  ts: string
  name: string
  kind: "tool" | "mcp" | "skill" | "agent"
  server?: string
  summary: string
  input?: unknown
  ok?: boolean
  error?: string
  durationMs?: number
  result?: unknown
}
export type ItemDetail = { summary: ItemSummary; lanes: Lane[]; events: Record<string, any>[]; state?: Record<string, any> }
export type Overview = {
  counts: { waiting: number; working: number; stopped: number; done: number }
  needsYou: { source: string; id: string; title: string; lane: string; detail: string }[]
}
export type WorktreeNode = {
  path: string
  branch: string | null
  items: ItemSummary[]
  live: boolean
  waiting: boolean
  dirty?: number
  ahead?: number
  behind?: number
}
export type ProjectNode = { key: string; name: string; path: string; worktrees: WorktreeNode[] }
export type SourceInfo = { name: string; harness: string; extras: string[]; actions: string[]; source: string | null; error?: string }
export type UsageBy = "model" | "project" | "harness" | "day" | "worktree" | "branch"
export type UsageQuery = { from?: string; to?: string; by?: UsageBy }
type UsageSums = Tokens & { cost: number; sessions: number }
export type UsageResult = {
  totals: UsageSums
  series: (UsageSums & { day: string; byKey: Record<string, number> })[]
  groups: (UsageSums & { key: string; name?: string })[]
  by: UsageBy
  tz: string
  from: string | null
  to: string | null
  complete: boolean
}
export type CallFilter = { lane?: string; kind?: string; q?: string }

const qs = (q: Record<string, string | undefined>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) if (v) p.set(k, v)
  const s = p.toString()
  return s ? `?${s}` : ""
}

/** The viewer's IANA zone; usage days are bucketed in it. */
export const browserTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
export const itemUrl = (source: string, id: string) => `/api/item/${encodeURIComponent(source)}/${encodeURIComponent(id)}`
export const callsUrl = (source: string, id: string, f: CallFilter = {}) =>
  `${itemUrl(source, id)}/calls${qs({ lane: f.lane, kind: f.kind, q: f.q })}`
export const usageUrl = (q: UsageQuery, tz: string) => `/api/usage${qs({ from: q.from, to: q.to, by: q.by ?? "model", tz })}`

const PROJECTS_POLL = 5000

export const useOverview = () => useFetch<Overview>("/api/overview", POLL)
export const useSources = () => useFetch<SourceInfo[]>("/api/sources")
/** The full project tree with every item; large on a busy machine, so it polls slower. Share it via ProjectsProvider. */
export const useProjects = () => useFetch<ProjectNode[]>("/api/projects", PROJECTS_POLL)
export const useProject = (key: string | null) =>
  useFetch<ProjectNode>(key ? `/api/project/${encodeURIComponent(key)}` : null, PROJECTS_POLL)
export const useItems = () => useFetch<ItemSummary[]>("/api/items", POLL)
export const useItem = (source: string, id: string | null) => useFetch<ItemDetail>(id ? itemUrl(source, id) : null, POLL)
export const useCalls = (source: string, id: string | null, f: CallFilter = {}) =>
  useFetch<Call[]>(id ? callsUrl(source, id, f) : null, POLL)
export const useUsage = (q: UsageQuery = {}) => useFetch<UsageResult>(usageUrl(q, browserTz()))
