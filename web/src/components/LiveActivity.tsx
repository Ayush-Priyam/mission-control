import { Bot, FileText, Pencil, Plug, Sparkles, SquareTerminal, Wrench, type LucideIcon } from "lucide-react"
import type { LiveLane } from "@/lib/api"
import { ago } from "@/lib/format"
import { toHash } from "@/lib/route"
import { StatusDot } from "@/components/StatusDot"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { modelName } from "@/lib/item"
import { groupLive, itemTitle, shortCommand } from "@/lib/live"

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

/**
 * Live now, grouped by item: one row per item (title, project · branch, age), its working lanes nested
 * as chips (lane · tool · short target · age). The title is the row's link; each chip shows the full
 * command in a tooltip on hover or focus.
 */
export function LiveActivity({ lanes, now = Date.now() }: { lanes: LiveLane[]; now?: number }) {
  if (!lanes.length) return <p className="px-1 py-4 text-xs text-faint">Nothing working right now</p>
  return (
    <TooltipProvider delay={150}>
      <ul className="flex flex-col">
        {groupLive(lanes).map((g) => {
          const f = g.first
          const title = itemTitle({ title: f.title, id: f.id, project: f.project?.name, ts: f.startedAt ?? f.updatedAt })
          return (
            <li key={g.key} className="relative border-b border-border/60 last:border-0 hover:bg-surface/60">
              <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 rounded-md px-2 py-2.5">
                <StatusDot status="working" className="mt-1.5" />
                <div className="min-w-0">
                  <a
                    href={toHash({ view: "item", source: g.source, id: g.id, tab: "lanes" })}
                    className="block truncate text-sm font-medium text-foreground after:absolute after:inset-0 after:content-['']"
                    title={f.title || f.id}
                  >
                    {title}
                  </a>
                  <div className="truncate font-mono text-xs text-muted-foreground">
                    {[f.project?.name ?? "(no project)", f.branch].filter(Boolean).join(" · ")}
                    {g.lanes.length > 1 && <span className="text-faint"> · {g.lanes.length} lanes working</span>}
                  </div>
                  <ul className="relative z-[1] mt-1.5 flex flex-wrap gap-1.5" aria-label="Working lanes">
                    {g.lanes.map((l) => (
                      <LaneChip key={l.lane} lane={l} now={now} />
                    ))}
                  </ul>
                </div>
                <span className="font-mono text-xs tabular-nums text-faint">{ago(g.latest || null, now)}</span>
              </div>
            </li>
          )
        })}
      </ul>
    </TooltipProvider>
  )
}

function LaneChip({ lane: l, now }: { lane: LiveLane; now: number }) {
  const d = l.nowDoing
  const Icon = doingIcon(d)
  const full = d ? `${d.name} ${d.summary}` : "thinking…"
  return (
    <li>
      <Tooltip>
        <TooltipTrigger
          render={<span tabIndex={0} />}
          className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border bg-card px-2 font-mono text-xs"
          aria-label={`${l.label}${l.model ? ` (${modelName(l.model)})` : ""}: ${full}, ${ago(d?.ts ?? l.startedAt ?? l.updatedAt, now)} ago`}
        >
          <span className="max-w-[24ch] shrink-0 truncate text-foreground">{l.label}</span>
          {l.model && <span className="shrink-0 text-faint">{modelName(l.model)}</span>}
          <Icon aria-hidden className="size-3 shrink-0 text-faint" />
          {d ? (
            <>
              <span className="shrink-0 text-foreground/80">{d.name}</span>
              <span className="min-w-0 truncate text-muted-foreground">{shortCommand(d.summary)}</span>
            </>
          ) : (
            <span className="text-faint">thinking…</span>
          )}
          <span className="shrink-0 text-faint tabular-nums">{ago(d?.ts ?? l.startedAt ?? l.updatedAt, now)}</span>
        </TooltipTrigger>
        <TooltipContent className="max-w-[60ch] font-mono text-xs break-all">{full}</TooltipContent>
      </Tooltip>
    </li>
  )
}
