import { useMemo, useState } from "react"
import { useProject, type ItemSummary, type ProjectNode } from "@/lib/api"
import { useNow } from "@/lib/format"
import { useShared } from "@/lib/projects-context"
import { toHash } from "@/lib/route"
import { matchesFilter, worktreeLabel } from "@/lib/tree"
import { ItemTable } from "@/components/ItemTable"
import { WorktreeCard } from "@/components/WorktreeCard"

/** A project's items, each carrying its worktree's branch when it has none of its own. */
export function projectItems(p: ProjectNode, worktree?: string): ItemSummary[] {
  return p.worktrees
    .filter((w) => worktree === undefined || w.path === worktree)
    .flatMap((w) => w.items.map((i) => ({ ...i, branch: i.branch ?? w.branch, project: { key: p.key, name: p.name, worktree: w.path } })))
}

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

/**
 * A project: its worktrees as cards (branch, dirty files, ahead/behind, live lanes, last activity) and
 * its runs and sessions. With `worktree`, the same page narrowed to that one worktree.
 */
export default function ProjectPage({ projectKey, worktree }: { projectKey: string; worktree?: string }) {
  const project = useProject(projectKey)
  const { overview, filter } = useShared()
  const [idleShown, setIdleShown] = useState(false)
  const now = useNow()
  const p = project.data
  const lanes = useMemo(() => (overview.data?.live ?? []).filter((l) => l.project?.key === projectKey), [overview.data, projectKey])
  const items = useMemo(() => (p ? projectItems(p, worktree).filter((i) => matchesFilter(i, filter)) : []), [p, worktree, filter])

  if (!p) {
    if (project.error)
      return <p className="text-sm text-failed">{/404/.test(project.error) ? "No such project (it has no sessions or runs now)." : `Could not load the project: ${project.error}`}</p>
    return <div className="h-40 animate-pulse rounded-xl border bg-card/50" aria-label="loading project" />
  }

  const wt = worktree === undefined ? null : (p.worktrees.find((w) => w.path === worktree) ?? null)
  const cards = worktree === undefined ? p.worktrees : wt ? [wt] : []
  const used = cards.filter((w) => w.counts.items || w.live)
  const idle = cards.length - used.length
  const shownCards = idleShown || worktree !== undefined ? cards : used
  const totals = p.worktrees.reduce((n, w) => n + w.counts.items, 0)

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold tracking-tight">{wt ? worktreeLabel(wt) : p.name}</h1>
          {p.hidden && <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">hidden by default</span>}
        </div>
        <p className="font-mono text-[11px] text-faint">
          {wt ? (
            <>
              <a href={toHash({ view: "project", key: p.key })} className="hover:text-foreground">
                {p.name}
              </a>{" "}
              · {wt.path}
            </>
          ) : (
            <>
              {p.path || "(no folder)"} · {p.worktrees.length} worktree{p.worktrees.length === 1 ? "" : "s"} · {totals} item{totals === 1 ? "" : "s"}
            </>
          )}
        </p>
      </header>

      {worktree !== undefined && !wt && <p className="text-sm text-muted-foreground">This worktree has no runs or sessions now.</p>}

      {shownCards.length > 0 && (
        <Section
          title={wt ? "Worktree" : "Worktrees"}
          aside={
            idle > 0 && (
              <button type="button" onClick={() => setIdleShown((v) => !v)} className="font-mono text-[11px] text-faint hover:text-foreground">
                {idleShown ? "hide idle worktrees" : `+ ${idle} idle worktree${idle === 1 ? "" : "s"}`}
              </button>
            )
          }
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {shownCards.map((w) => (
              <WorktreeCard key={w.path} projectKey={p.key} w={w} lanes={lanes.filter((l) => l.project?.worktree === w.path)} now={now} />
            ))}
          </div>
        </Section>
      )}

      <Section
        title="Runs and sessions"
        aside={filter && <span className="font-mono text-[11px] text-faint">filtered by the status chip</span>}
      >
        <div className="rounded-xl border bg-card p-2">
          <ItemTable items={items} showProject={false} now={now} empty={filter ? "Nothing here matches the status filter" : "No runs or sessions yet"} />
        </div>
      </Section>
    </div>
  )
}
