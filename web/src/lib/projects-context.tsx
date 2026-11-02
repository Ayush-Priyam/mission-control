import { createContext, useContext, useMemo, useState, type ReactNode } from "react"
import { useOverview, useProjects, type Overview, type ProjectSummary, type Remote } from "@/lib/api"
import { visibleProjects, type ChipFilter } from "@/lib/tree"

type Shared = {
  /** The slim tree as served, hidden projects included. */
  projects: Remote<ProjectSummary[]>
  /** What the sidebar, chips and Home show: hidden projects left out unless `showHidden`. */
  visible: ProjectSummary[]
  hiddenCount: number
  showHidden: boolean
  setShowHidden: (v: boolean) => void
  /** One /api/overview poll (counts, needs you, live lanes), hidden projects left out unless `showHidden`. */
  overview: Remote<Overview>
  filter: ChipFilter | null
  setFilter: (f: ChipFilter | null) => void
}
const Ctx = createContext<Shared | null>(null)

/** One slim /api/projects poll, one /api/overview poll, the status-chip filter and the show-hidden toggle, for the shell and every view. */
export function ProjectsProvider({ children }: { children: ReactNode }) {
  const projects = useProjects()
  const [showHidden, setShowHidden] = useState(false)
  const overview = useOverview(showHidden)
  const [filter, setFilter] = useState<ChipFilter | null>(null)
  const all = projects.data
  const visible = useMemo(() => visibleProjects(all ?? [], showHidden), [all, showHidden])
  const hiddenCount = useMemo(() => (all ?? []).filter((p) => p.hidden).length, [all])
  return (
    <Ctx.Provider value={{ projects, visible, hiddenCount, showHidden, setShowHidden, overview, filter, setFilter }}>{children}</Ctx.Provider>
  )
}

export function useShared(): Shared {
  const v = useContext(Ctx)
  if (!v) throw new Error("useShared needs a ProjectsProvider")
  return v
}
