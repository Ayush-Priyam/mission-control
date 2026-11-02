import { useMemo, useState } from "react"
import { ArrowDown, ArrowUp } from "lucide-react"
import type { ItemSummary, Status } from "@/lib/api"
import { ago, money } from "@/lib/format"
import { toHash } from "@/lib/route"
import { worktreeLabel } from "@/lib/tree"
import { cn } from "@/lib/utils"
import { STATUS_LABEL, STATUS_TEXT, StatusDot } from "@/components/StatusDot"

export type SortKey = "title" | "where" | "harness" | "status" | "lanes" | "calls" | "cost" | "updated"
export type SortDir = "asc" | "desc"

const URGENCY: Status[] = ["waiting", "working", "failed", "stopped", "done", "idle"]
const where = (i: ItemSummary) => `${i.project?.name ?? ""} ${i.branch ?? ""}`.trim().toLowerCase()
const time = (i: ItemSummary) => String(i.updatedAt ?? "")

const KEYS: Record<SortKey, (i: ItemSummary) => string | number> = {
  title: (i) => (i.title || i.id).toLowerCase(),
  where,
  harness: (i) => i.harness,
  status: (i) => URGENCY.indexOf(i.status),
  lanes: (i) => i.counts.lanes,
  calls: (i) => i.counts.calls,
  cost: (i) => i.cost ?? 0,
  updated: time,
}

/** Items ordered by a column; ties fall back to newest first. Does not mutate. */
export function sortItems(items: ItemSummary[], key: SortKey, dir: SortDir): ItemSummary[] {
  const get = KEYS[key]
  const sign = dir === "asc" ? 1 : -1
  return [...items].sort((a, b) => {
    const x = get(a), y = get(b)
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))
    return c * sign || time(b).localeCompare(time(a))
  })
}

type Col = { key: SortKey; label: string; first: SortDir; className?: string; num?: boolean }

/**
 * Runs and sessions as a dense, sortable table: title, project/branch, harness, status, lanes, calls,
 * cost, updated. Newest first; a header click sorts by that column, a second click flips it.
 */
export function ItemTable({
  items,
  showProject = true,
  empty = "Nothing here yet",
  cap = 100,
  now = Date.now(),
}: {
  items: ItemSummary[]
  /** Project name before the branch (Home); a project page shows the branch alone. */
  showProject?: boolean
  empty?: string
  /** Rows shown before a "Show all" button. */
  cap?: number
  now?: number
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "updated", dir: "desc" })
  const [all, setAll] = useState(false)
  const rows = useMemo(() => sortItems(items, sort.key, sort.dir), [items, sort])
  const shown = all ? rows : rows.slice(0, cap)

  const cols: Col[] = [
    { key: "title", label: "Title", first: "asc" },
    { key: "where", label: showProject ? "Project / branch" : "Branch", first: "asc", className: "w-[17%]" },
    { key: "harness", label: "Harness", first: "asc", className: "w-[92px]" },
    { key: "status", label: "Status", first: "asc", className: "w-[90px]" },
    { key: "lanes", label: "Lanes", first: "desc", num: true, className: "w-[54px]" },
    { key: "calls", label: "Calls", first: "desc", num: true, className: "w-[68px]" },
    { key: "cost", label: "Cost", first: "desc", num: true, className: "w-[60px]" },
    { key: "updated", label: "Updated", first: "desc", num: true, className: "w-[72px]" },
  ]
  const pick = (c: Col) =>
    setSort((s) => (s.key === c.key ? { key: c.key, dir: s.dir === "asc" ? "desc" : "asc" } : { key: c.key, dir: c.first }))

  if (!items.length) return <p className="px-1 py-6 text-center text-xs text-faint">{empty}</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-collapse text-xs">
        <thead>
          <tr className="border-b text-left">
            {cols.map((c) => {
              const on = sort.key === c.key
              return (
                <th
                  key={c.key}
                  aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                  className={cn("h-8 px-2 font-normal whitespace-nowrap text-faint", c.num && "text-right", c.className)}
                >
                  <button
                    type="button"
                    onClick={() => pick(c)}
                    className={cn("inline-flex items-center gap-1 hover:text-foreground", on && "text-muted-foreground")}
                  >
                    {c.label}
                    {on && (sort.dir === "asc" ? <ArrowUp aria-hidden className="size-3" /> : <ArrowDown aria-hidden className="size-3" />)}
                  </button>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {shown.map((i) => {
            const href = toHash({ view: "item", source: i.source, id: i.id, tab: "lanes" })
            // A folder that only repeats the project name says nothing.
            const folder = i.project ? worktreeLabel({ path: i.project.worktree, branch: null }) : ""
            const branch = i.branch || (showProject && folder === i.project?.name ? "" : folder)
            return (
              <tr key={`${i.source}/${i.id}`} className="group border-b border-border/60 hover:bg-surface/60">
                <td className="h-9 truncate px-2">
                  <a href={href} title={i.title || i.id} className="font-medium text-foreground/90 group-hover:text-foreground">
                    {i.title || i.id}
                  </a>
                </td>
                <td className="truncate px-2 font-mono text-[11px] text-muted-foreground">
                  {showProject && i.project && <span className="text-foreground/80">{i.project.name}</span>}
                  {showProject && i.project && branch && <span className="text-faint"> · </span>}
                  {branch}
                </td>
                <td className="truncate px-2 font-mono text-[11px] text-muted-foreground">{i.harness}</td>
                <td className="px-2 whitespace-nowrap">
                  <span className={cn("inline-flex items-center gap-1.5", STATUS_TEXT[i.status])}>
                    <StatusDot status={i.status} live={i.live} className="size-1.5" />
                    {STATUS_LABEL[i.status]}
                  </span>
                </td>
                <td className="px-2 text-right font-mono tabular-nums text-muted-foreground">{i.counts.lanes}</td>
                <td className="px-2 text-right font-mono tabular-nums text-muted-foreground">
                  {i.counts.calls}
                  {i.counts.errors > 0 && <span className="ml-1 text-failed">!{i.counts.errors}</span>}
                </td>
                <td className="px-2 text-right font-mono tabular-nums text-muted-foreground">{money(i.cost)}</td>
                <td className="px-2 text-right font-mono tabular-nums text-faint" title={i.updatedAt ?? undefined}>
                  {ago(i.updatedAt, now)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {!all && rows.length > cap && (
        <button type="button" onClick={() => setAll(true)} className="mt-2 px-2 font-mono text-[11px] text-faint hover:text-foreground">
          Show all {rows.length}
        </button>
      )}
    </div>
  )
}
