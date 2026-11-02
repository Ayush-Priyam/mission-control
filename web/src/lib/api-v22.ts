// v2.2 API shapes and hooks, kept apart from api.ts so they merge cleanly.
import { useFetch } from "@/lib/api"

export type JoinRow = { name: string; scope: string | null; configured: boolean; status: "used" | "unused" | "failing"; calls: number; errors: number; errorRate: number }
export type ItemConfig = { harness: string; servers: JoinRow[]; skills: JoinRow[]; plugins: string[] }
export type ProjectConfig = { sessions: number; unusedServers: { name: string; scope: string | null }[] }

const enc = encodeURIComponent
/** `refresh`: refetch when it changes (the item page passes its call count). */
export const useItemConfig = (source: string, id: string | null, refresh: unknown = 0) =>
  useFetch<ItemConfig>(id ? `/api/item/${enc(source)}/${enc(id)}/config` : null, 0, refresh)
export const useProjectConfig = (key: string | null) => useFetch<ProjectConfig>(key ? `/api/project/${enc(key)}/config` : null, 60_000)

export type EditSide = { source: string; id: string; title: string; branch: string | null; worktree: string | null; ts: string }
export type SameFile = { path: string; gapMs: number; a: EditSide; b: EditSide; text: string }
export const useItemConflicts = (source: string, id: string | null, pollMs = 30_000) =>
  useFetch<{ warnings: SameFile[] }>(id ? `/api/item/${enc(source)}/${enc(id)}/conflicts` : null, pollMs)
export const useProjectConflicts = (key: string | null, pollMs = 30_000) =>
  useFetch<{ warnings: SameFile[] }>(key ? `/api/project/${enc(key)}/conflicts` : null, pollMs)

export type TurnCost = { i: number; ts: string | null; model: string | null; in: number; out: number; cacheRead: number; cacheWrite: number; context: number; cost: number; compacted: boolean; why: string | null }
export type TurnCosts = { lane: string; turns: TurnCost[]; total: { cost: number; turns: number; compactions: number } }
export const useTurnCosts = (source: string, id: string | null, lane: string, pollMs = 0) =>
  useFetch<TurnCosts>(id ? `/api/item/${enc(source)}/${enc(id)}/turn-costs?lane=${enc(lane)}` : null, pollMs)

export type BudgetState = { scope: "project" | "worktree" | "branch"; match: string; period: "daily" | "weekly" | "monthly"; limit: number; spent: number; ratio: number; level: "ok" | "warn" | "over" }
export const useBudgets = (tz: string, pollMs = 60_000) => useFetch<{ today?: string; budgets: BudgetState[] }>(`/api/budgets?tz=${enc(tz)}`, pollMs)

export type PrRow = { key: string; project: string; projectName: string; branch: string; pr: { number: number; title: string; state?: string }; in: number; out: number; cacheRead: number; cacheWrite: number; cost: number; sessions: number }
export const usePrUsage = (q: { from?: string; to?: string } | null, tz: string) =>
  useFetch<{ gh: boolean; rows: PrRow[] }>(q ? `/api/usage/prs?${new URLSearchParams({ ...(q.from ? { from: q.from } : {}), ...(q.to ? { to: q.to } : {}), tz })}` : null)

/** The worst budget state, for the top-bar chip: null when every budget is under 80%. */
export function budgetAlert(list: BudgetState[] | undefined): BudgetState | null {
  const hot = (Array.isArray(list) ? list : []).filter((b) => b.level !== "ok").sort((a, b) => b.ratio - a.ratio)
  return hot[0] ?? null
}

export type UsageWindow =
  | { available: false }
  | { available: true; harness: string; estimate: true; complete: boolean; active: boolean; hours: number; start: string | null; resetsAt: string | null; used: { tokens: number; cost: number }; rate: { tokensPerHour: number; usdPerHour: number }; limit: { tokens?: number; usd?: number } | null; eta: number | null; hitsBeforeReset: boolean; message: string }
/** `tz` is sent like every usage request (the route itself works in UTC buckets). */
export const useUsageWindow = (tz: string, pollMs = 60_000) => useFetch<UsageWindow>(`/api/usage-window?tz=${enc(tz)}`, pollMs)
