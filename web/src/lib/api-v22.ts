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
