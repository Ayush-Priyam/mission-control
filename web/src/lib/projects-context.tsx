import { createContext, useContext, useState, type ReactNode } from "react"
import { useProjects, type ProjectNode, type Remote } from "@/lib/api"
import type { ChipFilter } from "@/lib/tree"

type Shared = { projects: Remote<ProjectNode[]>; filter: ChipFilter | null; setFilter: (f: ChipFilter | null) => void }
const Ctx = createContext<Shared | null>(null)

/** One /api/projects poll and the status-chip filter, shared by the shell (sidebar, chips, ⌘K) and every view. */
export function ProjectsProvider({ children }: { children: ReactNode }) {
  const projects = useProjects()
  const [filter, setFilter] = useState<ChipFilter | null>(null)
  return <Ctx.Provider value={{ projects, filter, setFilter }}>{children}</Ctx.Provider>
}

export function useShared(): Shared {
  const v = useContext(Ctx)
  if (!v) throw new Error("useShared needs a ProjectsProvider")
  return v
}
