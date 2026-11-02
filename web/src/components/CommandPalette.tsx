import { useEffect, useMemo, useRef, useState } from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { BarChart3, FolderGit2, GitBranch, House, Search } from "lucide-react"
import type { ProjectNode } from "@/lib/api"
import { paletteResults, type PaletteEntry } from "@/lib/tree"
import { cn } from "@/lib/utils"
import { StatusDot } from "@/components/StatusDot"

const KIND_LABEL: Record<PaletteEntry["kind"], string> = { page: "Go to", project: "Projects", worktree: "Worktrees", item: "Sessions and runs" }

function Icon({ e }: { e: PaletteEntry }) {
  if (e.kind === "item" && e.status) return <StatusDot status={e.status} live={e.live} />
  const cls = "size-3.5 text-muted-foreground"
  if (e.id === "page:home") return <House className={cls} />
  if (e.id === "page:usage") return <BarChart3 className={cls} />
  if (e.kind === "worktree") return <GitBranch className={cls} />
  return <FolderGit2 className={cls} />
}

/** True for the palette shortcut: ⌘K on a Mac, Ctrl+K elsewhere. */
export const isPaletteKey = (e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey">) =>
  e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)

/** ⌘K: jump to a page, project, worktree or item. Arrow keys move, Enter opens, Esc closes. */
export function CommandPalette({ open, onOpenChange, projects }: { open: boolean; onOpenChange: (o: boolean) => void; projects: ProjectNode[] }) {
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const results = useMemo(() => (open ? paletteResults(projects, query) : []), [open, projects, query])

  useEffect(() => {
    if (!open) setQuery("")
  }, [open])
  useEffect(() => setActive(0), [query])
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" })
  }, [active])

  const go = (e: PaletteEntry | undefined) => {
    if (!e) return
    location.hash = e.href
    onOpenChange(false)
  }
  const onKey = (ev: React.KeyboardEvent) => {
    if (ev.key === "ArrowDown") setActive((a) => Math.min(a + 1, results.length - 1))
    else if (ev.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0))
    else if (ev.key === "Enter") go(results[active])
    else return
    ev.preventDefault()
  }

  let lastKind: string | null = null
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/60 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <DialogPrimitive.Popup
          aria-label="Search projects and sessions"
          className="fixed top-[12vh] left-1/2 z-50 flex max-h-[70vh] w-[min(640px,94vw)] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl transition duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0"
        >
          <DialogPrimitive.Title className="sr-only">Search</DialogPrimitive.Title>
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
            <Search className="size-4 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKey}
              placeholder="Search projects, branches, sessions, runs…"
              aria-label="Search"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
            />
            <kbd className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-faint">esc</kbd>
          </div>
          <div ref={list} role="listbox" className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {!results.length && <p className="px-3 py-6 text-center text-sm text-faint">nothing matches “{query}”</p>}
            {results.map((e, i) => {
              const head = e.kind !== lastKind ? KIND_LABEL[e.kind] : null
              lastKind = e.kind
              return (
                <div key={e.id}>
                  {head && <div className="px-2.5 pt-2 pb-1 font-mono text-[10px] tracking-wider text-faint uppercase">{head}</div>}
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    data-index={i}
                    onMouseMove={() => setActive(i)}
                    onClick={() => go(e)}
                    className={cn(
                      "flex h-9 w-full items-center gap-3 rounded-md px-2.5 text-left text-sm",
                      i === active ? "bg-accent text-accent-foreground" : "text-foreground/90",
                    )}
                  >
                    <span className="grid w-4 place-items-center">
                      <Icon e={e} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{e.label}</span>
                    <span className="max-w-[45%] truncate font-mono text-[11px] text-faint">{e.hint}</span>
                  </button>
                </div>
              )
            })}
          </div>
          <div className="flex shrink-0 gap-4 border-t border-border px-4 py-2 font-mono text-[10px] text-faint">
            <span>↑↓ move</span>
            <span>↵ open</span>
            <span>⌘K toggle</span>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
