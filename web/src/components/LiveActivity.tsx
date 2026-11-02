import { Bot, FileText, Pencil, Plug, Sparkles, SquareTerminal, Wrench, type LucideIcon } from "lucide-react"
import type { LiveLane } from "@/lib/api"
import { ago } from "@/lib/format"
import { toHash } from "@/lib/route"
import { StatusDot } from "@/components/StatusDot"

/** An icon for what a lane is doing: edits, shell, reads, MCP, skills, agents, any other tool. */
export function doingIcon(d: { name: string; kind: string } | null | undefined): LucideIcon {
  if (!d) return Wrench
  if (d.kind === "mcp") return Plug
  if (d.kind === "skill") return Sparkles
  if (d.kind === "agent" || d.name === "Agent" || d.name === "Task") return Bot
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(d.name)) return Pencil
  if (/^(Bash|BashOutput|KillShell)$/.test(d.name)) return SquareTerminal
  if (/^(Read|Grep|Glob|LS|WebFetch|WebSearch)$/.test(d.name)) return FileText
  return Wrench
}

/** Every live lane, newest activity first: project · item · lane, what it is doing now, and how long ago. */
export function LiveActivity({ lanes, now = Date.now() }: { lanes: LiveLane[]; now?: number }) {
  if (!lanes.length) return <p className="px-1 py-4 text-xs text-faint">Nothing running right now</p>
  return (
    <ul className="flex flex-col">
      {lanes.map((l) => {
        const d = l.nowDoing
        const Icon = doingIcon(d)
        return (
          <li key={`${l.source}/${l.id}/${l.lane}`} className="border-b border-border/60 last:border-0">
            <a
              href={toHash({ view: "item", source: l.source, id: l.id, tab: "lanes" })}
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 rounded-md px-2 py-2 hover:bg-surface/60"
            >
              <StatusDot status="working" className="mt-1" />
              <div className="min-w-0">
                <div className="flex min-w-0 items-baseline gap-1.5 text-xs">
                  <span className="shrink-0 text-muted-foreground">{l.project?.name ?? "(no project)"}</span>
                  <span className="text-faint">·</span>
                  <span className="truncate text-foreground/90">{l.title || l.id}</span>
                  <span className="text-faint">·</span>
                  <span className="shrink-0 font-mono text-xs text-running">{l.label}</span>
                  {l.model && <span className="shrink-0 font-mono text-xs text-faint">{l.model}</span>}
                </div>
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5 font-mono text-xs text-muted-foreground">
                  <Icon aria-hidden className="size-3 shrink-0 text-faint" />
                  {d ? (
                    <>
                      <span className="shrink-0 text-foreground/80">{d.name}</span>
                      <span className="truncate">{d.summary}</span>
                    </>
                  ) : (
                    <span className="text-faint">thinking…</span>
                  )}
                </div>
              </div>
              <span className="font-mono text-xs tabular-nums text-faint">{ago(d?.ts ?? l.startedAt ?? l.updatedAt, now)}</span>
            </a>
          </li>
        )
      })}
    </ul>
  )
}
