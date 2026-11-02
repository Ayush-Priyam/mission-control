import type { LiveLane, WorktreeSummary } from "@/lib/api"
import { ago } from "@/lib/format"
import { toHash } from "@/lib/route"
import { rollupCounts, worktreeLabel } from "@/lib/tree"
import { cn } from "@/lib/utils"
import { doingIcon } from "@/components/LiveActivity"
import { StatusDot } from "@/components/StatusDot"

/** One worktree: branch, dirty files, ahead/behind, its live lanes and when it last moved. */
export function WorktreeCard({
  projectKey,
  w,
  lanes,
  selected,
  now = Date.now(),
}: {
  projectKey: string
  w: WorktreeSummary
  /** Live lanes in this worktree (from the overview). */
  lanes: LiveLane[]
  selected?: boolean
  now?: number
}) {
  const st = rollupCounts([w.counts])
  const c = w.counts
  const tallies = [
    c.waiting && { n: c.waiting, label: "needs you", cls: "text-needs-you" },
    c.working && { n: c.working, label: "working", cls: "text-running" },
    c.failed && { n: c.failed, label: "failed", cls: "text-failed" },
    c.stopped && { n: c.stopped, label: "stopped", cls: "text-stopped" },
  ].filter(Boolean) as { n: number; label: string; cls: string }[]
  return (
    <a
      href={toHash({ view: "worktree", key: projectKey, path: w.path })}
      aria-current={selected ? "page" : undefined}
      className={cn(
        "flex flex-col gap-2 rounded-xl border bg-card p-4 transition-colors hover:border-ring",
        w.waiting && "border-needs-you/50",
        !w.waiting && w.live && "border-running/40",
        selected && "ring-1 ring-ring",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <StatusDot status={st} live={w.live} />
          <span className="truncate font-mono text-sm font-medium">{worktreeLabel(w)}</span>
        </span>
        <span className="shrink-0 font-mono text-xs text-faint" title={w.updatedAt ?? undefined}>
          {w.updatedAt ? ago(w.updatedAt, now) : "no sessions"}
        </span>
      </div>
      <div className="truncate font-mono text-xs text-faint" title={w.path}>
        {w.path || "(no folder)"}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs">
        {w.dirty === undefined ? (
          <span className="text-faint">no git status</span>
        ) : w.dirty ? (
          <span className="rounded bg-muted px-1.5 py-0.5 text-foreground">±{w.dirty} changed</span>
        ) : (
          <span className="rounded bg-secondary px-1.5 py-0.5 text-muted-foreground">clean</span>
        )}
        {!!w.ahead && <span className="rounded bg-secondary px-1.5 py-0.5 text-muted-foreground">↑{w.ahead} ahead</span>}
        {!!w.behind && <span className="rounded bg-secondary px-1.5 py-0.5 text-muted-foreground">↓{w.behind} behind</span>}
      </div>
      {lanes.length > 0 && (
        <ul className="flex flex-col gap-1 border-t border-border/60 pt-2">
          {lanes.slice(0, 3).map((l) => {
            const Icon = doingIcon(l.nowDoing)
            return (
              <li key={`${l.id}/${l.lane}`} className="flex min-w-0 items-center gap-1.5 font-mono text-xs text-muted-foreground">
                <StatusDot status="working" className="size-1.5" />
                <span className="shrink-0 text-running">{l.label}</span>
                <Icon aria-hidden className="size-3 shrink-0 text-faint" />
                <span className="truncate">{l.nowDoing ? `${l.nowDoing.name} ${l.nowDoing.summary}` : "thinking…"}</span>
              </li>
            )
          })}
          {lanes.length > 3 && <li className="font-mono text-xs text-faint">+ {lanes.length - 3} more live</li>}
        </ul>
      )}
      <div className="mt-auto flex items-center justify-between gap-2 text-xs">
        <span className="flex gap-2">
          {tallies.map((t) => (
            <span key={t.label} className={t.cls}>
              {t.n} {t.label}
            </span>
          ))}
        </span>
        <span className="font-mono text-faint">
          {lanes.length ? <span className="text-running">{lanes.length} live · </span> : null}
          {c.items} {c.items === 1 ? "item" : "items"}
        </span>
      </div>
    </a>
  )
}
