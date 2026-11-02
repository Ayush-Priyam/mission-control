import type { RunSummary } from "@/lib/api"

export const repoName = (repo?: string) => String(repo ?? "").split(/[\\/]/).filter(Boolean).pop() ?? ""
/** Waiting on you, as the adapter computed it with the shared stop rule (src/status.mjs). */
export const isWaiting = (r: RunSummary) => r.waiting === true
