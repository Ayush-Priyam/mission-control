import { useState } from "react"
import { Plug, Zap } from "lucide-react"
import type { ItemConfig, JoinRow } from "@/lib/api-v22"
import { cn } from "@/lib/utils"

const TONE: Record<JoinRow["status"], string> = { used: "text-running", failing: "text-failed", unused: "text-muted-foreground" }

/** One row's state in words: "used · 12×", "failing · 3/4 errored", "loaded, not used". */
export function joinLabel(r: JoinRow): string {
  if (r.status === "unused") return "loaded, not used"
  if (r.status === "failing") return `failing · ${r.errors}/${r.calls} errored`
  return `used · ${r.calls}×${r.errors ? ` · ${r.errors} failed` : ""}${r.configured ? "" : " · not in config"}`
}

const UNUSED_SHOWN = 6

function Rows({ rows, icon, what }: { rows: JoinRow[]; icon: "plug" | "zap"; what: string }) {
  const [all, setAll] = useState(false)
  const active = rows.filter((r) => r.status !== "unused")
  const unused = rows.filter((r) => r.status === "unused")
  const shown = all ? unused : unused.slice(0, UNUSED_SHOWN)
  const Icon = icon === "plug" ? Plug : Zap
  if (!rows.length) return <div className="text-xs text-muted-foreground">No {what} configured or called.</div>
  return (
    <ul className="space-y-1 text-xs" aria-label={what}>
      {[...active, ...shown].map((r) => (
        <li key={r.name} data-join={r.status} className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <Icon className={cn("size-3.5 shrink-0", r.status === "unused" ? "text-faint" : icon === "plug" ? "text-llm" : "text-tool")} />
            <span className={cn("truncate", r.status === "unused" && "text-muted-foreground")} title={r.scope ? `${r.name} · ${r.scope} config` : r.name}>{r.name}</span>
          </span>
          <span className={cn("shrink-0 font-mono", TONE[r.status])}>{joinLabel(r)}</span>
        </li>
      ))}
      {unused.length > UNUSED_SHOWN && (
        <li>
          <button type="button" onClick={() => setAll((v) => !v)} className="font-mono text-xs text-faint hover:text-foreground">
            {all ? "show fewer" : `+ ${unused.length - UNUSED_SHOWN} more loaded, not used`}
          </button>
        </li>
      )}
    </ul>
  )
}

/** Configured MCP servers and skills of this session, each used / loaded-but-unused / failing. Names only. */
export function ConfigJoin({ config }: { config: ItemConfig }) {
  const count = (rows: JoinRow[], s: JoinRow["status"]) => rows.filter((r) => r.status === s).length
  return (
    <section aria-label="Config vs calls" className="rounded-xl border bg-card p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-xs tracking-wide text-muted-foreground uppercase">Config vs calls · this session</div>
        <div className="font-mono text-xs text-faint">
          {count(config.servers, "unused")} servers and {count(config.skills, "unused")} skills loaded, not used
          {count(config.servers, "failing") + count(config.skills, "failing") > 0 && <span className="text-failed"> · {count(config.servers, "failing") + count(config.skills, "failing")} failing</span>}
        </div>
      </div>
      <div className="mt-2 grid gap-4 md:grid-cols-2">
        <div>
          <div className="mb-1 text-xs text-muted-foreground">MCP servers</div>
          <Rows rows={config.servers} icon="plug" what="MCP servers" />
        </div>
        <div>
          <div className="mb-1 text-xs text-muted-foreground">Skills</div>
          <Rows rows={config.skills} icon="zap" what="skills" />
        </div>
      </div>
    </section>
  )
}
