import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { KIND, TONE, displayName, fmtDuration, fmtTime, iconOf, outcome } from "@/components/CallList"
import { Markdown } from "@/components/Markdown"
import { StatusDot } from "@/components/StatusDot"
import { turnsUrl, useFetch, type Call, type Lane, type ToolChip, type Turn, type TurnPage } from "@/lib/api"
import { toHash } from "@/lib/route"
import { cn } from "@/lib/utils"

// The Chat tab for an item with a transcript (a Claude Code session): one lane at a time, its turns newest
// last, tool uses as chips that expand to their arguments and result. Long sessions load a page at a time.

/** Turns per page: a 2,000-turn session never renders all at once. */
export const PAGE = 60
const LIVE_POLL = 3000
const SHOWN_CHIPS = 8

const asCall = (c: ToolChip, lane: string): Call => ({ ...c, lane, ts: "" })

function Chip({ c, open, onToggle }: { c: ToolChip; open: boolean; onToggle: () => void }) {
  const Icon = iconOf(asCall(c, ""))
  const o = outcome(asCall(c, ""))
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      title={c.summary}
      className={cn(
        "inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px]",
        open ? "border-zinc-500 bg-zinc-800/70" : "border-border bg-muted/30 hover:bg-muted/60",
        c.ok === false && "border-failed/50",
      )}
    >
      <Icon className={cn("size-3.5 shrink-0", KIND[c.kind].text)} />
      <span className={cn("shrink-0", KIND[c.kind].text)}>{displayName(asCall(c, ""))}</span>
      <span className="max-w-[28ch] min-w-0 truncate text-muted-foreground">{c.summary}</span>
      <span className={cn("shrink-0", TONE[o.tone])}>{o.text}</span>
      {open ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0 text-muted-foreground" />}
    </button>
  )
}

const Pre = ({ children, bad }: { children: string; bad?: boolean }) => (
  <pre className={cn("max-h-64 overflow-auto rounded-md border bg-background/60 p-2.5 font-mono text-[11.5px] break-words whitespace-pre-wrap", bad ? "border-failed/40 text-red-300" : "text-foreground/85")}>{children}</pre>
)

function ChipDetail({ c, href, onOpenLane, subLane }: { c: ToolChip; href: string; subLane?: { id: string; label: string }; onOpenLane: (lane: string) => void }) {
  const args = c.input === undefined ? null : typeof c.input === "string" ? c.input : JSON.stringify(c.input, null, 2)
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/20 p-3" aria-label={`${c.name} detail`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
        <span className={KIND[c.kind].text}>{displayName(asCall(c, ""))}</span>
        <span>{KIND[c.kind].type}</span>
        <span>{fmtDuration(c.durationMs)}</span>
        <span className="flex-1" />
        {subLane && (
          <button type="button" className="text-sky-300 hover:underline" onClick={() => onOpenLane(subLane.id)}>
            open {subLane.label} →
          </button>
        )}
        <a className="text-foreground/80 hover:underline" href={href}>
          open in Calls ↗
        </a>
      </div>
      <span className="text-[10.5px] tracking-wide text-muted-foreground uppercase">Arguments</span>
      {args === null ? <span className="text-xs text-muted-foreground">None recorded.</span> : <Pre>{args}</Pre>}
      <span className="text-[10.5px] tracking-wide text-muted-foreground uppercase">{c.ok === false ? "Error" : "Result"}</span>
      {c.ok === false ? <Pre bad>{c.error ?? "error"}</Pre> : c.result ? <Pre>{c.result}</Pre> : <span className="text-xs text-muted-foreground">{c.ok === undefined ? "No result yet." : "No output."}</span>}
    </div>
  )
}

/** Tags the harness wraps around text it injects as a "user" turn: not something the owner typed. */
const SYSTEM_TAGS = ["task-notification", "system-reminder", "local-command-stdout", "local-command-stderr", "bash-stdout", "bash-stderr", "local-command-caveat", "command-name", "command-message", "command-args", "user-prompt-submit-hook"]
const SYSTEM_RE = new RegExp(`^\\s*<(${SYSTEM_TAGS.join("|")})>`)

/** A user turn the harness injected: its tag and a one-line gist (a task notification's summary, else the text without tags). */
export function systemNote(text: string): { kind: string; text: string } | null {
  const m = SYSTEM_RE.exec(text)
  if (!m) return null
  const summary = /<summary>([\s\S]*?)<\/summary>/.exec(text)?.[1]
  const gist = (summary ?? text.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
  return { kind: m[1], text: gist }
}

/** Consecutive turns of one role read as one block; inside it, tool-only turns share a chip row. Injected turns are "system" blocks. */
export type Block = { role: Turn["role"] | "system"; turns: Turn[] }
export function blocks(turns: Turn[]): Block[] {
  const out: Block[] = []
  for (const t of turns) {
    const last = out[out.length - 1]
    const role: Block["role"] = t.role === "user" && !t.tools.length && systemNote(t.text) ? "system" : t.role
    if (last && last.role === role && role === "assistant") last.turns.push(t)
    else out.push({ role, turns: [t] })
  }
  return out
}

/** A harness-injected turn: one dim line, the raw text on demand. */
function SystemNote({ t }: { t: Turn }) {
  const [open, setOpen] = useState(false)
  const n = systemNote(t.text)!
  return (
    <li data-turn={t.i} data-system className="flex flex-col gap-1.5 px-4">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`system note: ${n.kind}`}
        onClick={() => setOpen(!open)}
        className="flex min-w-0 items-center gap-2 self-start rounded-md border border-dashed border-border/70 px-2 py-0.5 font-mono text-[11px] text-faint hover:text-muted-foreground"
      >
        {open ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />}
        <span className="shrink-0">system note · {n.kind}</span>
        {n.text && <span className="max-w-[60ch] min-w-0 truncate">{n.text}</span>}
        {t.ts && <span className="shrink-0">{fmtTime(t.ts)}</span>}
      </button>
      {open && <Pre>{t.text}</Pre>}
    </li>
  )
}
/** A block's pieces in order: text, or a row of chips (merged across tool-only turns). */
function pieces(b: Block) {
  const out: ({ k: "text"; t: Turn } | { k: "chips"; key: string; chips: ToolChip[] })[] = []
  for (const t of b.turns) {
    if (t.text) out.push({ k: "text", t })
    if (!t.tools.length) continue
    const last = out[out.length - 1]
    if (last?.k === "chips" && !t.text) last.chips.push(...t.tools)
    else out.push({ k: "chips", key: `c${t.i}`, chips: [...t.tools] })
  }
  return out
}

type BlockProps = {
  b: Block
  who: string
  open: Set<string>
  toggle: (id: string) => void
  callHref: (id: string) => string
  subLanes: Map<string, { id: string; label: string }>
  onOpenLane: (lane: string) => void
}

function Chips({ chips, open, toggle, callHref, subLanes, onOpenLane }: Omit<BlockProps, "b" | "who"> & { chips: ToolChip[] }) {
  const [all, setAll] = useState(false)
  const shown = all ? chips : chips.slice(0, SHOWN_CHIPS)
  const opened = chips.filter((c) => open.has(c.id))
  return (
    <>
      <div className="flex flex-wrap gap-1.5" aria-label="Tool calls">
        {shown.map((c) => (
          <Chip key={c.id} c={c} open={open.has(c.id)} onToggle={() => toggle(c.id)} />
        ))}
        {chips.length > SHOWN_CHIPS && (
          <button type="button" onClick={() => setAll(!all)} className="rounded-md border border-dashed px-2 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground">
            {all ? "fewer" : `+${chips.length - SHOWN_CHIPS} more`}
          </button>
        )}
      </div>
      {opened.map((c) => (
        <ChipDetail key={c.id} c={c} href={callHref(c.id)} subLane={subLanes.get(c.id)} onOpenLane={onOpenLane} />
      ))}
    </>
  )
}

function BlockView({ b, who, ...rest }: BlockProps) {
  if (b.role === "system") return <SystemNote t={b.turns[0]} />
  const user = b.role === "user"
  const a = b.turns[0], z = b.turns[b.turns.length - 1]
  return (
    <li data-turn={a.i} className={cn("flex flex-col gap-2 rounded-xl border px-4 py-2.5", user ? "border-consult/25 bg-consult/[0.06]" : "border-transparent")}>
      <div className="flex items-center gap-2 font-mono text-[10.5px] tracking-wider">
        <span className={cn("uppercase", user ? "text-consult" : "text-foreground/80")}>{user ? "you" : who}</span>
        <span className="text-faint">{a.ts ? fmtTime(a.ts) : ""}{z !== a && z.ts ? ` – ${fmtTime(z.ts)}` : ""}</span>
        <span className="text-faint">#{a.i + 1}{z !== a ? `–${z.i + 1}` : ""}</span>
      </div>
      {pieces(b).map((p) =>
        p.k === "text" ? (
          user ? (
            <p key={`t${p.t.i}`} className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">{p.t.text}</p>
          ) : (
            <Markdown key={`t${p.t.i}`} text={p.t.text} className="break-words" />
          )
        ) : (
          <Chips key={p.key} chips={p.chips} {...rest} />
        ),
      )}
    </li>
  )
}

type LaneProps = { source: string; id: string; lane: Lane | undefined; laneId: string; live: boolean; subLanes: Map<string, { id: string; label: string }>; onOpenLane: (lane: string) => void }

/** One lane's transcript: the newest page polled while live, earlier pages on demand, merged by turn index. */
function LaneChat({ source, id, lane, laneId, live, subLanes, onOpenLane }: LaneProps) {
  const latest = useFetch<TurnPage>(turnsUrl(source, id, laneId, { limit: PAGE }), live ? LIVE_POLL : 0)
  const [turns, setTurns] = useState<Map<number, Turn>>(() => new Map())
  const [total, setTotal] = useState(0)
  const [earlier, setEarlier] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null })
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const box = useRef<HTMLDivElement>(null)
  const keep = useRef<{ height: number; top: number } | null>(null)
  const stick = useRef(true)

  const merge = (p: TurnPage) => {
    setTotal(p.total)
    setTurns((m) => {
      const n = new Map(m)
      for (const t of p.turns) n.set(t.i, t)
      return n
    })
  }
  useEffect(() => {
    if (latest.data) merge(latest.data)
  }, [latest.data])

  const list = useMemo(() => [...turns.values()].sort((a, b) => a.i - b.i), [turns])
  const first = list[0]?.i ?? 0

  // Loading earlier keeps the reader where they were; new turns at the end follow only a reader at the bottom.
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    if (keep.current) {
      el.scrollTop = keep.current.top + (el.scrollHeight - keep.current.height)
      keep.current = null
    } else if (stick.current) el.scrollTop = el.scrollHeight
  }, [list])

  const loadEarlier = async () => {
    if (earlier.busy) return
    setEarlier({ busy: true, error: null })
    try {
      const r = await fetch(turnsUrl(source, id, laneId, { before: first, limit: PAGE }))
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const p = (await r.json()) as TurnPage
      const el = box.current
      if (el) keep.current = { height: el.scrollHeight, top: el.scrollTop }
      merge(p)
      setEarlier({ busy: false, error: null })
    } catch (e: any) {
      setEarlier({ busy: false, error: String(e?.message ?? e) })
    }
  }

  const toggle = (cid: string) =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(cid)) n.delete(cid)
      else n.add(cid)
      return n
    })
  const callHref = (cid: string) => toHash({ view: "item", source, id, tab: "calls", call: cid })
  const who = laneId === "main" ? "claude" : lane?.label ?? laneId

  if (!latest.data && latest.loading) return <p className="p-6 font-mono text-xs text-muted-foreground">Loading the transcript…</p>
  if (!latest.data && latest.error)
    return <p className="p-6 text-center font-mono text-[13px] text-muted-foreground">{/404|not found/i.test(latest.error) ? "No transcript recorded for this item." : `Transcript not available (${latest.error}).`}</p>

  return (
    <div
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
      }}
      className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
    >
      {first > 0 && (
        <div className="flex flex-col items-center gap-1 pb-3">
          <button type="button" onClick={loadEarlier} disabled={earlier.busy} className="rounded-md border px-3 py-1.5 font-mono text-[11px] hover:bg-muted disabled:opacity-60">
            {earlier.busy ? "Loading…" : `Load earlier (${first} more)`}
          </button>
          {earlier.error && <span className="font-mono text-[11px] text-failed">Could not load earlier turns ({earlier.error})</span>}
        </div>
      )}
      {list.length === 0 ? (
        <p className="p-6 text-center font-mono text-[13px] text-muted-foreground">No messages in this lane yet.</p>
      ) : (
        <ol className="mx-auto flex max-w-[900px] flex-col gap-2" aria-label="Transcript" data-total={total}>
          {blocks(list).map((b) => (
            <BlockView key={b.turns[0].i} b={b} who={who} open={open} toggle={toggle} callHref={callHref} subLanes={subLanes} onOpenLane={onOpenLane} />
          ))}
        </ol>
      )}
    </div>
  )
}

type Props = { source: string; id: string; lanes: Lane[]; live: boolean; calls: Call[] | null }

/** The Chat tab: a lane picker (main or a sub-agent) over that lane's transcript. */
export default function Chat({ source, id, lanes, live, calls }: Props) {
  const ids = lanes.map((l) => l.id)
  const [pick, setPick] = useState<string>(() => (ids.includes("main") ? "main" : ids[0] ?? "main"))
  const laneId = ids.length === 0 || ids.includes(pick) ? pick : ids[0]
  const lane = lanes.find((l) => l.id === laneId)
  // Agent tool calls that ran as a sub-agent lane: the chip offers that lane's chat.
  const subLanes = useMemo(() => {
    const label = new Map(lanes.map((l) => [l.id, l.label]))
    const m = new Map<string, { id: string; label: string }>()
    for (const c of calls ?? []) if (c.subLane && label.has(c.subLane)) m.set(c.id, { id: c.subLane, label: label.get(c.subLane)! })
    return m
  }, [calls, lanes])

  return (
    <div className="flex h-[calc(100vh-19rem)] min-h-[420px] flex-col overflow-hidden rounded-xl border bg-card" aria-label="Chat">
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5">
        <b className="font-mono text-[13px] font-bold">Chat</b>
        {lanes.length > 1 && (
          <label className="flex min-w-0 items-center gap-2 font-mono text-[11px] text-muted-foreground">
            lane
            <select
              aria-label="Lane"
              value={laneId}
              onChange={(e) => setPick(e.target.value)}
              className="h-7 max-w-[340px] min-w-0 truncate rounded-md border bg-muted/40 px-2 text-xs text-foreground outline-none focus-visible:border-ring"
            >
              {lanes.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                  {l.kind === "subagent" ? ` (${l.calls} calls)` : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        {lane && <StatusDot status={lane.status} />}
        {lane?.model && <span className="font-mono text-[11px] text-muted-foreground">{lane.model}</span>}
      </div>
      <LaneChat key={laneId} source={source} id={id} lane={lane} laneId={laneId} live={live} subLanes={subLanes} onOpenLane={setPick} />
    </div>
  )
}
