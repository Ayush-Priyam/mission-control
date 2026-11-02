import { Plug, Zap } from "lucide-react"
import type { Call } from "@/lib/calls-api"
import { isError } from "@/components/CallList"
import { cn } from "@/lib/utils"

export type ToolRow = { key: string; label: string; count: number; mcp: boolean; server?: string; name: string }

/** Tool, MCP and agent calls by name; MCP tools sit together under their server. Groups by total, then rows by count. */
export function toolBreakdown(calls: Call[], limit = 8): ToolRow[] {
  const groups = new Map<string, { total: number; rows: Map<string, ToolRow> }>()
  for (const c of calls) {
    if (c.kind === "skill") continue
    const mcp = c.kind === "mcp"
    const g = mcp ? `mcp:${c.server ?? ""}` : `tool:${c.name}`
    const key = mcp ? `${c.server ?? ""}.${c.name}` : c.name
    const grp = groups.get(g) ?? groups.set(g, { total: 0, rows: new Map() }).get(g)!
    grp.total++
    const row = grp.rows.get(key) ?? grp.rows.set(key, { key, label: mcp && c.server ? `${c.server} · ${c.name}` : c.name, count: 0, mcp, server: mcp ? c.server : undefined, name: c.name }).get(key)!
    row.count++
  }
  return [...groups.values()]
    .sort((a, b) => b.total - a.total)
    .flatMap((g) => [...g.rows.values()].sort((a, b) => b.count - a.count))
    .slice(0, limit)
}

export function skillBreakdown(calls: Call[]) {
  const m = new Map<string, { name: string; count: number; errors: number }>()
  for (const c of calls) {
    if (c.kind !== "skill") continue
    const s = m.get(c.name) ?? m.set(c.name, { name: c.name, count: 0, errors: 0 }).get(c.name)!
    s.count++
    if (isError(c)) s.errors++
  }
  return [...m.values()].sort((a, b) => b.count - a.count)
}

export function serverCounts(calls: Call[]) {
  const m = new Map<string, number>()
  for (const c of calls) if (c.kind === "mcp" && c.server) m.set(c.server, (m.get(c.server) ?? 0) + 1)
  return [...m].map(([server, count]) => ({ server, count })).sort((a, b) => b.count - a.count)
}

const Label = ({ children, className }: { children: string; className?: string }) => (
  <div className={cn("text-[11px] tracking-wide text-muted-foreground uppercase", className)}>{children}</div>
)

/** The two cards above the call rows: by tool, and skills invoked + MCP servers. */
export function CallBreakdown({ calls }: { calls: Call[] }) {
  const tools = toolBreakdown(calls, 6)
  const max = Math.max(1, ...tools.map((t) => t.count))
  const skills = skillBreakdown(calls)
  const servers = serverCounts(calls)
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-xl border bg-card p-3">
        <Label>By tool</Label>
        <div className="mt-2 space-y-1.5 font-mono text-xs">
          {tools.length === 0 && <div className="font-sans text-muted-foreground">No tool calls.</div>}
          {tools.map((t) => (
            <div key={t.key} className="flex items-center gap-2">
              {t.server ? (
                <span className="flex w-48 min-w-0 items-baseline gap-1" title={t.label}>
                  <span className="min-w-0 truncate">{t.server}</span>
                  <span className="max-w-[70%] shrink-0 truncate">· {t.name}</span>
                </span>
              ) : (
                <span className="w-48 truncate" title={t.label}>{t.label}</span>
              )}
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <i className={cn("block h-full rounded-full", t.mcp ? "bg-violet-500" : "bg-zinc-400 dark:bg-zinc-300")} style={{ width: `${(t.count / max) * 100}%` }} />
              </div>
              <span className="w-8 text-right">{t.count}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-xl border bg-card p-3">
        <Label>Skills invoked</Label>
        <div className="mt-2 max-h-28 space-y-2 overflow-y-auto text-xs">
          {skills.length === 0 && <div className="text-muted-foreground">No skills invoked.</div>}
          {skills.map((s) => (
            <div key={s.name} className="flex justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <Zap className="size-3.5 shrink-0 text-amber-500" />
                <span className="truncate">{s.name}</span>
              </span>
              <span className={cn("shrink-0", s.errors ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400")}>
                used · {s.count}×{s.errors ? ` · ${s.errors} failed` : ""}
              </span>
            </div>
          ))}
        </div>
        <Label className="mt-3">MCP servers</Label>
        <div className="mt-1 flex flex-wrap gap-2 text-xs">
          {servers.length === 0 && <span className="text-muted-foreground">None called.</span>}
          {servers.map((s) => (
            <span key={s.server} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1">
              <Plug className="size-3.5 text-violet-500" />
              {s.server} <span className="font-mono">{s.count}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
