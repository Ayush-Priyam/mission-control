import { createContext, useContext, type ReactNode } from "react"
import { useRuns, type Remote, type RunSummary } from "@/lib/api"

const Ctx = createContext<Remote<RunSummary[]> | null>(null)

/** One /api/runs poll shared by the shell and every view. */
export function RunsProvider({ children }: { children: ReactNode }) {
  const runs = useRuns()
  return <Ctx.Provider value={runs}>{children}</Ctx.Provider>
}

export function useSharedRuns(): Remote<RunSummary[]> {
  const v = useContext(Ctx)
  if (!v) throw new Error("useSharedRuns needs a RunsProvider")
  return v
}

export const repoName = (repo?: string) => String(repo ?? "").split(/[\\/]/).filter(Boolean).pop() ?? ""
export const isWaiting = (r: RunSummary) => Object.values(r.stages ?? {}).some((s) => s.status === "stopped")
