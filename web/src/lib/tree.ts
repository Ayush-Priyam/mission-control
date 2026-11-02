import type { ItemSummary, ProjectNode, Status, WorktreeNode } from "./api"
import { toHash } from "./route"

/** The status chips' filters. `stopped` covers failed too; `done` means done today. */
export type ChipFilter = "waiting" | "working" | "stopped" | "done"

const RANK: Status[] = ["waiting", "working", "failed", "stopped", "done", "idle"]

/** One status for a group of items: the most urgent one present. */
export function rollup(items: Pick<ItemSummary, "status">[]): Status {
  let best = RANK.length - 1
  for (const i of items) {
    const r = RANK.indexOf(i.status)
    if (r >= 0 && r < best) best = r
  }
  return RANK[best]
}

const localDay = (d: Date) => d.toLocaleDateString("en-CA")

export function matchesFilter(i: ItemSummary, f: ChipFilter | null, now = new Date()): boolean {
  if (!f) return true
  if (f === "stopped") return i.status === "stopped" || i.status === "failed"
  if (f === "done") return i.status === "done" && !!i.updatedAt && localDay(new Date(i.updatedAt)) === localDay(now)
  return i.status === f
}

export function doneToday(projects: ProjectNode[], now = new Date()): number {
  let n = 0
  for (const p of projects) for (const w of p.worktrees) for (const i of w.items) if (matchesFilter(i, "done", now)) n++
  return n
}

const base = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? ""
export const worktreeLabel = (w: Pick<WorktreeNode, "path" | "branch">) => w.branch || base(w.path) || "(no folder)"

/** The tree narrowed by a text query (project name/path, worktree branch/path) and a chip filter (items). */
export function filterTree(projects: ProjectNode[], query: string, f: ChipFilter | null, now = new Date()): ProjectNode[] {
  const q = query.trim().toLowerCase()
  const has = (s: string | null | undefined) => !!s && s.toLowerCase().includes(q)
  const out: ProjectNode[] = []
  for (const p of projects) {
    const projectHit = !q || has(p.name) || has(p.path)
    const worktrees: WorktreeNode[] = []
    for (const w of p.worktrees) {
      if (!projectHit && !has(w.branch) && !has(w.path)) continue
      if (!f) {
        worktrees.push(w)
        continue
      }
      const items = w.items.filter((i) => matchesFilter(i, f, now))
      if (items.length) worktrees.push({ ...w, items })
    }
    if (worktrees.length) out.push({ ...p, worktrees })
  }
  return out
}

export type PaletteEntry = {
  id: string
  kind: "page" | "project" | "worktree" | "item"
  label: string
  hint: string
  href: string
  status?: Status
  live?: boolean
}

const PAGES: PaletteEntry[] = [
  { id: "page:home", kind: "page", label: "Home", hint: "needs you, live activity, recent", href: toHash({ view: "home" }) },
  { id: "page:usage", kind: "page", label: "Usage", hint: "tokens and cost", href: toHash({ view: "usage" }) },
]
const LIMIT = 50

const urgency = (i: ItemSummary) => (i.status === "waiting" ? 0 : i.live ? 1 : 2)

/** ⌘K results: pages, projects, worktrees (only when searching) and items, needs-you and live items first. */
export function paletteResults(projects: ProjectNode[], query: string): PaletteEntry[] {
  const q = query.trim().toLowerCase()
  const hit = (...s: (string | null | undefined)[]) => !q || s.some((x) => !!x && x.toLowerCase().includes(q))
  const out: PaletteEntry[] = PAGES.filter((p) => hit(p.label))
  const worktrees: PaletteEntry[] = []
  const items: { i: ItemSummary; hint: string }[] = []
  for (const p of projects) {
    if (hit(p.name, p.path)) {
      const st = rollup(p.worktrees.flatMap((w) => w.items))
      out.push({ id: `project:${p.key}`, kind: "project", label: p.name, hint: p.path, href: toHash({ view: "project", key: p.key }), status: st })
    }
    for (const w of p.worktrees) {
      const label = worktreeLabel(w)
      if (q && hit(w.branch, w.path))
        worktrees.push({
          id: `worktree:${p.key}:${w.path}`,
          kind: "worktree",
          label: `${p.name} · ${label}`,
          hint: w.path,
          href: toHash({ view: "worktree", key: p.key, path: w.path }),
          status: rollup(w.items),
        })
      for (const i of w.items) if (hit(i.title, i.id)) items.push({ i, hint: `${p.name} · ${label}` })
    }
  }
  out.push(...worktrees)
  items.sort((a, b) => urgency(a.i) - urgency(b.i) || String(b.i.updatedAt ?? "").localeCompare(String(a.i.updatedAt ?? "")))
  for (const { i, hint } of items) {
    if (out.length >= LIMIT) break
    out.push({
      id: `item:${i.source}/${i.id}`,
      kind: "item",
      label: i.title || i.id,
      hint,
      href: toHash({ view: "item", source: i.source, id: i.id, tab: "lanes" }),
      status: i.status,
      live: i.live,
    })
  }
  return out.slice(0, LIMIT)
}
