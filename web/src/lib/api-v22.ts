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
