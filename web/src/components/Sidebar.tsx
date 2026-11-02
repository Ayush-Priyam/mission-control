import { useMemo, useState } from "react"
import { BarChart3, ChevronRight, House, Search } from "lucide-react"
import type { ProjectNode, WorktreeNode } from "@/lib/api"
import { toHash, type Route } from "@/lib/route"
import { filterTree, rollup, worktreeLabel, type ChipFilter } from "@/lib/tree"
import { cn } from "@/lib/utils"
import { StatusDot } from "@/components/StatusDot"

const count = (ws: WorktreeNode[]) => ws.reduce((n, w) => n + w.items.length, 0)

/** Which project/worktree the current route points at (an item page selects the worktree holding it). */
function selection(route: Route, projects: ProjectNode[]): { key?: string; path?: string } {
  if (route.view === "project") return { key: route.key }
  if (route.view === "worktree") return { key: route.key, path: route.path }
  if (route.view === "item")
    for (const p of projects)
      for (const w of p.worktrees)
        if (w.items.some((i) => i.source === route.source && i.id === route.id)) return { key: p.key, path: w.path }
  return {}
}

function WorktreeRow({ p, w, selected }: { p: ProjectNode; w: WorktreeNode; selected: boolean }) {
  const st = rollup(w.items)
  const live = w.items.filter((i) => i.live).length
  return (
    <a
      href={toHash({ view: "worktree", key: p.key, path: w.path })}
      title={live ? `${w.path} · ${live} live` : w.path}
      aria-current={selected ? "page" : undefined}
      className={cn(
        "group flex h-7 items-center gap-2 rounded-md pr-2 pl-2 font-mono text-xs text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
        selected && "bg-sidebar-accent text-sidebar-accent-foreground",
      )}
    >
      <StatusDot status={st} live={w.live} className="size-1.5" />
      <span className="min-w-0 flex-1 truncate">{worktreeLabel(w)}</span>
      {!!w.dirty && <span className="text-[10px] text-needs-you/80" title={`${w.dirty} changed files`}>±{w.dirty}</span>}
      <span className="w-7 text-right text-[11px] tabular-nums text-faint">{w.items.length || ""}</span>
    </a>
  )
}

function ProjectRow({
  p,
  open,
  onToggle,
  sel,
  showEmpty,
  onShowEmpty,
}: {
  p: ProjectNode
  open: boolean
  onToggle: () => void
  sel: { key?: string; path?: string }
  showEmpty: boolean
  onShowEmpty: () => void
}) {
  const all = p.worktrees.flatMap((w) => w.items)
  const st = rollup(all)
  const live = p.worktrees.some((w) => w.live)
  const used = p.worktrees.filter((w) => w.items.length || w.path === sel.path)
  const empty = p.worktrees.length - used.length
  const shown = showEmpty ? p.worktrees : used
  const selected = sel.key === p.key && !sel.path
  return (
    <li>
      <div
        className={cn(
          "group flex h-8 items-center rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent/60",
          selected && "bg-sidebar-accent text-sidebar-accent-foreground",
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-label={open ? `Collapse ${p.name}` : `Expand ${p.name}`}
          aria-expanded={open}
          className="grid h-8 w-6 shrink-0 place-items-center text-faint hover:text-foreground"
        >
          <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        </button>
        <a href={toHash({ view: "project", key: p.key })} title={p.path} className="flex h-8 min-w-0 flex-1 items-center gap-2 pr-2">
          <StatusDot status={st} live={live} />
          <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
          <span className="font-mono text-[11px] tabular-nums text-faint">{count(p.worktrees)}</span>
        </a>
      </div>
      {open && (
        <ul className="mt-0.5 mb-1 ml-[11px] flex flex-col gap-px border-l border-sidebar-border pl-2">
          {shown.map((w) => (
            <li key={w.path}>
              <WorktreeRow p={p} w={w} selected={sel.key === p.key && sel.path === w.path} />
            </li>
          ))}
          {empty > 0 && (
            <li>
              <button
                type="button"
                onClick={onShowEmpty}
                className="h-6 pl-2 font-mono text-[11px] text-faint hover:text-muted-foreground"
              >
                {showEmpty ? "hide idle worktrees" : `+ ${empty} idle worktree${empty === 1 ? "" : "s"}`}
              </button>
            </li>
          )}
        </ul>
      )}
    </li>
  )
}

function NavLink({ href, active, icon, children }: { href: string; active: boolean; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <a
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground [&_svg]:size-4",
        active && "bg-sidebar-accent text-sidebar-accent-foreground",
      )}
    >
      {icon}
      {children}
    </a>
  )
}

/** Left project tree (projects → worktrees), CCO / harness-deck style: dense, counts, status dots, live pulse. */
export function Sidebar({
  projects,
  loading,
  error,
  route,
  filter,
  footer,
}: {
  projects: ProjectNode[]
  loading: boolean
  error: string | null
  route: Route
  filter: ChipFilter | null
  footer: string
}) {
  const [query, setQuery] = useState("")
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const [emptyShown, setEmptyShown] = useState<Record<string, boolean>>({})
  const tree = useMemo(() => filterTree(projects, query, filter), [projects, query, filter])
  const sel = useMemo(() => selection(route, projects), [route, projects])
  const searching = query.trim() !== "" || filter !== null
  // Open by default: projects with something live or waiting, and the selected one. A click overrides.
  const isOpen = (p: ProjectNode) =>
    toggled[p.key] ?? (searching || sel.key === p.key || p.worktrees.some((w) => w.live || w.waiting))

  return (
    <aside className="flex h-full w-[264px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <nav className="flex flex-col gap-px border-b border-sidebar-border p-2">
        <NavLink href={toHash({ view: "home" })} active={route.view === "home"} icon={<House />}>
          Home
        </NavLink>
        <NavLink href={toHash({ view: "usage" })} active={route.view === "usage"} icon={<BarChart3 />}>
          Usage
        </NavLink>
      </nav>
      <div className="px-2 pt-2">
        <label className="flex h-8 items-center gap-2 rounded-md border border-sidebar-border bg-background/40 px-2 text-muted-foreground focus-within:border-ring">
          <Search className="size-3.5 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter projects, branches"
            aria-label="Filter projects"
            className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-faint"
          />
        </label>
      </div>
      <div className="flex items-center justify-between px-3 pt-3 pb-1 font-mono text-[11px] tracking-wider text-faint uppercase">
        <span>Projects</span>
        <span className="tabular-nums">{tree.length}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {loading && !projects.length && <p className="px-2 py-1 text-xs text-faint">loading projects…</p>}
        {error && !projects.length && <p className="px-2 py-1 text-xs text-failed">could not load projects: {error}</p>}
        {!loading && !error && !tree.length && (
          <p className="px-2 py-1 text-xs text-faint">{searching ? "nothing matches" : "no projects yet"}</p>
        )}
        <ul className="flex flex-col gap-px">
          {tree.map((p) => (
            <ProjectRow
              key={p.key}
              p={p}
              open={isOpen(p)}
              onToggle={() => setToggled((t) => ({ ...t, [p.key]: !isOpen(p) }))}
              sel={sel}
              showEmpty={!!emptyShown[p.key]}
              onShowEmpty={() => setEmptyShown((t) => ({ ...t, [p.key]: !t[p.key] }))}
            />
          ))}
        </ul>
      </div>
      <div className="border-t border-sidebar-border px-3 py-2 font-mono text-[10px] text-faint">{footer}</div>
    </aside>
  )
}
