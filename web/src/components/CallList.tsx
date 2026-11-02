import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent } from "react"
import { Bot, FilePen, FileText, Plug, Search, Terminal, Wrench, Zap } from "lucide-react"
import type { Call, CallKind } from "@/lib/api"
import { cn } from "@/lib/utils"

export type Chip = "all" | CallKind | "errors"
export type ChipCounts = Record<Chip, number>
export type CallFilter = { lane: string | null; chip: Chip; q: string }

export const isError = (c: Call) => c.ok === false

/** Calls in `lane` (null: every lane) whose name, summary or MCP server contains `q`, narrowed to `chip`. */
export function filterCalls(calls: Call[], { lane, chip, q }: CallFilter): Call[] {
  const needle = q.trim().toLowerCase()
  return calls.filter(
    (c) =>
      (lane === null || c.lane === lane) &&
      (chip === "all" || (chip === "errors" ? isError(c) : c.kind === chip)) &&
      (!needle || [c.name, c.summary, c.server ?? ""].some((t) => t.toLowerCase().includes(needle))),
  )
}

export function chipCounts(calls: Call[]): ChipCounts {
  const n: ChipCounts = { all: calls.length, tool: 0, mcp: 0, skill: 0, agent: 0, errors: 0 }
  for (const c of calls) {
    if (c.kind in n) n[c.kind]++
    if (isError(c)) n.errors++
  }
  return n
}

export const KIND: Record<CallKind, { label: string; type: string; icon: ComponentType<{ className?: string }>; text: string }> = {
  tool: { label: "Tools", type: "Tool", icon: Wrench, text: "text-foreground" },
  mcp: { label: "MCP", type: "MCP tool", icon: Plug, text: "text-llm" },
  skill: { label: "Skills", type: "Skill", icon: Zap, text: "text-tool" },
  agent: { label: "Agents", type: "Sub-agent", icon: Bot, text: "text-foreground" },
}

const TOOL_ICON: Record<string, ComponentType<{ className?: string }>> = {
  Bash: Terminal, Read: FileText, Grep: Search, Glob: Search, Edit: FilePen, Write: FilePen, MultiEdit: FilePen,
}
export const iconOf = (c: Call) => (c.kind === "tool" ? TOOL_ICON[c.name] : undefined) ?? KIND[c.kind].icon

/** "server.tool" for MCP, "skill name" for skills, the tool name otherwise. */
export const displayName = (c: Call) => (c.kind === "mcp" && c.server ? `${c.server}.${c.name}` : c.kind === "skill" ? `skill ${c.name}` : c.name)

/**
 * "server · tool" where only the server truncates, so a long MCP server never hides the tool.
 * Skills read "skill <name>"; other calls are just the name.
 */
export function CallName({ call: c, className }: { call: Call; className?: string }) {
  if (c.kind === "mcp" && c.server)
    return (
      <span className={cn("flex min-w-0 items-baseline gap-1", className)} title={displayName(c)}>
        <span className="min-w-0 truncate">{c.server}</span>
        <span className="shrink-0">· {c.name}</span>
      </span>
    )
  return (
    <span className={cn("min-w-0 truncate", className)} title={displayName(c)}>
      {c.kind === "skill" ? `skill ${c.name}` : c.name}
    </span>
  )
}

export function fmtTime(ts: string) {
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

export function fmtDuration(ms: number | undefined) {
  if (ms === undefined || !Number.isFinite(ms)) return "—"
  if (ms < 10_000) return `${(Math.max(ms, 100) / 1000).toFixed(1)}s`
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

/** Short outcome: "ok", "exit N" for a failed shell command, "error", or "…" while the call has no result. */
export function outcome(c: Call): { text: string; tone: "ok" | "error" | "pending" } {
  if (c.ok === true) return { text: "ok", tone: "ok" }
  if (c.ok === false) {
    const m = /^Exit code (\d+)/.exec(c.error ?? "")
    return { text: m ? `exit ${m[1]}` : "error", tone: "error" }
  }
  return { text: "…", tone: "pending" }
}
export const TONE = { ok: "text-running", error: "text-failed", pending: "text-muted-foreground" }

/** Rows [start, end) to render for a fixed-height list scrolled to `scrollTop`. */
export function windowRange({ count, rowHeight, scrollTop, height, overscan }: { count: number; rowHeight: number; scrollTop: number; height: number; overscan: number }) {
  const visible = Math.ceil(height / rowHeight)
  const end = Math.min(count, Math.ceil((scrollTop + height) / rowHeight) + overscan)
  const start = Math.max(0, Math.min(Math.floor(scrollTop / rowHeight) - overscan, count - visible - overscan))
  return { start, end }
}

const ROW = 36 // px per row, 32 + 4 gap
/** The DOM id of a call's option row (for aria-activedescendant). */
export const optionId = (id: string) => `call-${id.replace(/[^\w-]/g, "_")}`
const WINDOW_FROM = 500

type Props = {
  calls: Call[]
  selectedId: string | null
  onSelect: (id: string) => void
  /** Lane id -> label; when given, each row shows its lane. */
  laneLabel?: (lane: string) => string
  empty?: string
}

/** The index `key` moves `i` to in a list of `n` rows (-1: nothing active yet), or null for other keys. */
export function moveIndex(key: string, i: number, n: number): number | null {
  if (!n) return null
  switch (key) {
    case "ArrowDown":
      return Math.min(n - 1, i + 1)
    case "ArrowUp":
      return i < 0 ? 0 : Math.max(0, i - 1)
    case "Home":
      return 0
    case "End":
      return n - 1
    default:
      return null
  }
}

/**
 * Call rows in the given order; plain up to 500 rows, windowed beyond that. A keyboard listbox: the list
 * takes focus, ↑/↓/Home/End move the active row (aria-activedescendant, kept in view even when windowed),
 * Enter or Space opens it (onSelect). A click activates and opens.
 */
export function CallList({ calls, selectedId, onSelect, laneLabel, empty = "No calls." }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ top: 0, height: 600 })
  const [activeId, setActiveId] = useState<string | null>(selectedId)
  const windowed = calls.length > WINDOW_FROM
  useEffect(() => {
    if (selectedId) setActiveId(selectedId)
  }, [selectedId])

  useEffect(() => {
    const el = ref.current
    if (!el || !windowed) return
    const measure = () => setView({ top: el.scrollTop, height: el.clientHeight || 600 })
    measure()
    el.addEventListener("scroll", measure, { passive: true })
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure)
    ro?.observe(el)
    return () => {
      el.removeEventListener("scroll", measure)
      ro?.disconnect()
    }
  }, [windowed])

  const reveal = (i: number, centre: boolean) => {
    const el = ref.current
    if (!el || i < 0) return
    const h = el.clientHeight || 600
    if (i * ROW < el.scrollTop || (i + 1) * ROW > el.scrollTop + h) el.scrollTop = Math.max(0, centre ? i * ROW - h / 2 : i * ROW < el.scrollTop ? i * ROW : (i + 1) * ROW - h)
    if (windowed) setView({ top: el.scrollTop, height: h })
  }

  // A selection made elsewhere (a timeline tick, a link) scrolls its row into view; a click on a visible row does not move.
  useEffect(() => {
    reveal(selectedId ? calls.findIndex((c) => c.id === selectedId) : -1, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the selection changes, never on a poll
  }, [selectedId])

  if (calls.length === 0) return <div className="px-3 py-6 text-sm text-muted-foreground">{empty}</div>

  const activeIndex = activeId ? calls.findIndex((c) => c.id === activeId) : -1
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.key === "Enter" || e.key === " ") && activeIndex >= 0) {
      e.preventDefault()
      onSelect(calls[activeIndex].id)
      return
    }
    const next = moveIndex(e.key, activeIndex, calls.length)
    if (next === null) return
    e.preventDefault()
    setActiveId(calls[next].id)
    reveal(next, false)
  }

  const { start, end } = windowed
    ? windowRange({ count: calls.length, rowHeight: ROW, scrollTop: view.top, height: view.height, overscan: 12 })
    : { start: 0, end: calls.length }

  return (
    <div
      ref={ref}
      role="listbox"
      tabIndex={0}
      aria-label="Calls"
      aria-activedescendant={activeIndex >= 0 ? optionId(calls[activeIndex].id) : undefined}
      onKeyDown={onKeyDown}
      onFocus={() => {
        if (activeIndex < 0) setActiveId(calls[0].id)
      }}
      className="group/list @container min-h-0 flex-1 overflow-y-auto rounded-md"
    >
      <div className="relative" style={{ height: calls.length * ROW }}>
        {calls.slice(start, end).map((c, i) => {
          const Icon = iconOf(c)
          const o = outcome(c)
          const sel = c.id === selectedId
          const act = c.id === activeId
          return (
            <div
              key={c.id}
              id={optionId(c.id)}
              role="option"
              aria-selected={sel}
              aria-posinset={start + i + 1}
              aria-setsize={calls.length}
              data-active={act || undefined}
              onClick={() => {
                setActiveId(c.id)
                onSelect(c.id)
              }}
              style={{ top: (start + i) * ROW }}
              className={cn(
                "absolute inset-x-0 flex h-8 cursor-pointer items-center gap-3 rounded-md border px-3 font-mono text-xs",
                sel ? "border-ring/40 bg-accent" : "border-transparent hover:bg-muted/60",
                act && "group-focus-visible/list:outline-2 group-focus-visible/list:-outline-offset-2 group-focus-visible/list:outline-focus group-focus-visible/list:outline",
              )}
            >
              <span className="w-16 shrink-0 text-muted-foreground">{fmtTime(c.ts)}</span>
              <span className={cn("flex w-36 shrink-0 items-center gap-1.5 overflow-hidden @3xl:w-48 @5xl:w-64", KIND[c.kind].text)}>
                <Icon className="size-3.5 shrink-0" />
                <CallName call={c} />
              </span>
              {laneLabel && <span className="hidden w-24 shrink-0 truncate text-muted-foreground @xl:inline" title={laneLabel(c.lane)}>{laneLabel(c.lane)}</span>}
              <span className="min-w-[16ch] flex-1 truncate text-foreground/80">{c.summary}</span>
              <span className={cn("shrink-0", TONE[o.tone])} title={c.error}>{o.text}</span>
              <span className="hidden w-12 shrink-0 text-right text-muted-foreground @lg:inline">{fmtDuration(c.durationMs)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
