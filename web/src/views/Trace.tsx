import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react"
import { ChevronRight, Copy, Diamond, Pencil, Rows3, Search, X } from "lucide-react"
import { buildTrace, type Span, type Trace as TraceData } from "../../../src/trace.mjs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { SessionSheet } from "@/components/SessionSheet"
import { hhmm } from "@/lib/events"
import { sessionFile } from "@/lib/transcript"
import { cn } from "@/lib/utils"

// The run as a waterfall: stage → session → tool spans from trace.mjs's buildTrace, an axis with
// markers and folded idle breaks, and a detail card under the clicked row (ported from the old page).

type Ev = Record<string, any>

/** Every idle stretch is folded to this many ms on the axis. */
const BREAK = 4000
/** Axis markers by kind: the tooltip's lead word. */
const MARK: Record<string, string> = { error: "Error", stop: "Stop", wait: "Waits on you", human: "You", question: "Question", gap: "Not checked" }
const STEPS = [200, 500, 1, 2, 5, 10, 15, 20, 30, 60, 120, 300, 600, 900, 1200, 1800, 3600, 7200, 10800, 21600, 43200].map((s, i) => (i < 2 ? s : s * 1000))

export const dur = (ms: number) => {
  ms = Math.max(0, ms || 0)
  if (ms < 10000) return `${(ms / 1000).toFixed(1)}s`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`
}
const tick = (ms: number) => {
  if (ms < 1000 && ms > 0) return `${ms / 1000}s`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60), h = Math.floor(m / 60)
  if (h) return `${h}h${m % 60 ? ` ${m % 60}m` : ""}`
  return `${m}m${s % 60 ? ` ${s % 60}s` : ""}`
}
const money = (c: number) => (c > 0 && c < 0.01 ? `$${c.toFixed(3)}` : `$${(c || 0).toFixed(2)}`)
const toks = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n || 0))

/** Axis domain: a round number of 4–6 ticks just past the end. */
function scale(endT: number) {
  const e = Math.max(endT * 1.03, 1000)
  for (const step of STEPS) {
    const n = Math.ceil(e / step)
    if (n <= 5) return { step, n, D: n * step }
  }
  const step = Math.ceil(e / 5 / 3600000) * 3600000
  return { step, n: 5, D: step * 5 }
}

const family = (name: string) =>
  /^mcp__/.test(name) ? "mcp"
  : /^(Read|Glob|Grep|LS|WebSearch|WebFetch|web_?search|ToolSearch)$/i.test(name) ? "find"
  : /^(Bash|BashOutput|KillShell|Shell)$/i.test(name) ? "bash"
  : /^(Edit|Write|MultiEdit|NotebookEdit)$/i.test(name) ? "edit"
  : "other"

function Icon({ s }: { s: Span }) {
  const box = "grid size-4 flex-none place-items-center"
  if (s.kind === "stage")
    return (
      <i className="relative mx-0.5 size-3 flex-none rounded-full border-[1.5px] border-foreground">
        <i className="absolute inset-[2px] rounded-full bg-failed" />
      </i>
    )
  if (s.kind === "session")
    return <i className={cn(box, "rounded-full bg-llm/30 font-mono text-[9px] font-bold not-italic uppercase text-foreground")}>{(s.name || "?")[0]}</i>
  if (s.kind === "group") return <Rows3 className="size-3 flex-none text-muted-foreground" />
  const f = family(String(s.name ?? ""))
  if (f === "bash") return <i className={cn(box, "font-mono text-[8.5px] font-bold not-italic tracking-tighter text-tool")}>&gt;_</i>
  const I = f === "find" ? Search : f === "edit" ? Pencil : f === "mcp" ? Copy : Diamond
  return <I className="size-3 flex-none text-tool" />
}

// A progress event with no tool field (a plain status line) still becomes a tool span: name it "progress".
const nameOf = (s: Span) => (s.kind === "tool" ? String(s.name || "progress").replace(/^mcp__/, "").replace(/__/g, " · ") : String(s.name ?? ""))

/** `run`: the span is still running and the run is live (a dead run spins nothing). */
type Row = { s: Span; key: string; depth: number; kids: number; shut: boolean; approx: boolean; root: boolean; run: boolean }

/** Collapsed by default: a session with more than 30 tool calls, and post-run groups spread over the run. */
const defaultShut = (s: Span) => s.kind === "group" || (s.kind === "session" && s.children.length > 30)

function flatten(spans: Span[], open: Map<string, boolean>, approx: Set<string>, live: boolean): Row[] {
  const rows: Row[] = []
  const walk = (list: Span[], pk: string, depth: number, ax: boolean) =>
    list.forEach((s, i) => {
      const key = s.kind === "group" ? `g:${s.name}` : s.kind === "stage" ? `st:${s.name}:${s.t0}` : s.kind === "session" ? `${pk}/s${i}:${s.t0}` : `${pk}/t${i}`
      const kids = s.children.length
      const shut = kids > 0 && (open.has(key) ? !open.get(key) : defaultShut(s))
      const a = depth === 0 ? s.kind === "stage" && approx.has(s.name) : ax
      rows.push({ s, key, depth, kids, shut, approx: a, root: depth === 0, run: s.running && live })
      if (kids && !shut) walk(s.children, key, depth + 1, a)
    })
  walk(spans, "", 0, false)
  return rows
}

/** Compressed t back to real ms from the run start: every break before t hides realMs − BREAK. */
function realAt(tr: TraceData, t: number) {
  let add = 0
  for (const b of tr.breaks) if (b.t < t) add += Math.max(0, b.realMs - BREAK) * Math.min(1, (t - b.t) / BREAK)
  return t + add
}

/** A transcript's input (the "## Prompt" section) and output (after the last "## Reply"), clipped for the card. */
function io(text: string) {
  const t = String(text ?? "")
  const clip = (x: string, tail: boolean) => {
    x = x.trim()
    return x.length <= 300 ? x : tail ? "…" + x.slice(-300).trimStart() : x.slice(0, 300).trimEnd() + "…"
  }
  const pm = t.match(/^##\s*Prompt\s*$/m)
  const ri = t.lastIndexOf("\n## Reply")
  const start = pm ? pm.index! + pm[0].length : -1
  const input = start >= 0 ? t.slice(start, ri > start ? ri : undefined) : ""
  const output = ri > start ? t.slice(t.indexOf("\n", ri + 1) + 1) : ""
  return { input: clip(input.trim() ? input : t, false), output: clip(output.trim() ? output : t, !output.trim()) }
}

type Status = TraceData["status"] | "ended"
const PILL: Record<string, { word: string; cls: string }> = {
  live: { word: "Live", cls: "text-consult border-consult/40 bg-consult/12" },
  running: { word: "Running", cls: "text-consult border-consult/40 bg-consult/12" },
  done: { word: "Done", cls: "text-running border-running/40 bg-running/12" },
  waiting: { word: "Waiting on you", cls: "text-needs-you border-needs-you/40 bg-needs-you/12" },
  ended: { word: "Ended", cls: "text-muted-foreground border-muted-foreground/40 bg-muted-foreground/12" },
  stopped: { word: "Stopped", cls: "text-failed border-failed/40 bg-failed/12" },
  error: { word: "Error", cls: "text-failed border-failed/40 bg-failed/12" },
}
function Pill({ status }: { status: string }) {
  const p = PILL[status] ?? PILL.stopped
  const pulse = status === "live" || status === "running"
  return (
    <span className={cn("inline-flex flex-none items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px]", p.cls)}>
      <i className={cn("size-1.5 rounded-full bg-current", pulse && "animate-pulse motion-reduce:animate-none")} />
      {p.word}
    </span>
  )
}

function Tip({ tip, children, className, style, bar }: { tip: ReactNode; children: ReactNode; className?: string; style?: CSSProperties; bar?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className={className} style={style} data-bar={bar ? "" : undefined} />}>{children}</TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  )
}

function Stats({ tr, wall }: { tr: TraceData; wall: number }) {
  const T = tr.totals
  const n = tr.breaks.length
  const cells: { k: string; v: string | number; tip?: string; sub?: string; lsub?: string; bad?: boolean }[] = [
    { k: "DURATION", v: dur(T.durationMs), lsub: "active", tip: n ? `Active time. Wall clock ${dur(wall)}, with ${n} idle break${n > 1 ? "s" : ""} folded to 4s each` : "Active time" },
    { k: "COST", v: money(T.cost) },
    { k: "TOKENS", v: toks(T.tokensIn + T.tokensOut), tip: `${toks(T.tokensIn)} in · ${toks(T.tokensOut)} out` },
    { k: "LLM CALLS", v: T.llmCalls },
    { k: "TOOL CALLS", v: T.toolCalls },
    {
      k: "ERRORS",
      v: T.errors,
      bad: T.errors > 0,
      tip: "Failure stops, failed checks and blocking issues an agent owns. Stops that wait on you are counted as waits",
      sub: T.waits ? `${T.waits} wait${T.waits > 1 ? "s" : ""} on you` : "",
    },
  ]
  return (
    <div className="grid grid-cols-3 gap-x-3.5 gap-y-2.5 border-b px-4 pt-3 pb-3.5 md:grid-cols-6" aria-label="Trace totals">
      {cells.map((c) => {
        const body = (
          <>
            <span className="font-mono text-[10px] tracking-widest whitespace-nowrap text-muted-foreground">
              {c.k}
              {c.lsub && <small className="ml-1.5 tracking-wide normal-case">{c.lsub}</small>}
            </span>
            <b className={cn("block text-lg leading-tight font-medium tracking-tight whitespace-nowrap tabular-nums md:text-[22px]", c.bad && "text-failed")}>{c.v}</b>
            {c.sub && <small className="block truncate font-mono text-[10px] text-needs-you">{c.sub}</small>}
          </>
        )
        return c.tip ? (
          <Tip key={c.k} tip={c.tip} className="min-w-0 cursor-help">
            {body}
          </Tip>
        ) : (
          <div key={c.k} className="min-w-0">
            {body}
          </div>
        )
      })}
    </div>
  )
}

/** The collapsed row's bar: its descendants as a stacked strip. */
function Mini({ s }: { s: Span }) {
  const len = Math.max(1, s.t1 - s.t0)
  const out: ReactNode[] = []
  const add = (c: Span) => {
    if (out.length > 240) return
    out.push(
      <u
        key={out.length}
        className={cn("absolute top-[2px] bottom-[2px] min-w-[2px] rounded-[1px]", c.error ? "bg-failed" : c.kind === "tool" ? "bg-tool" : "bg-llm opacity-75")}
        style={{ left: `${((c.t0 - s.t0) / len) * 100}%`, width: `${(Math.max(0, c.t1 - c.t0) / len) * 100}%` }}
      />,
    )
    c.children.forEach(add)
  }
  s.children.forEach(add)
  return <>{out}</>
}

function barClass(r: Row) {
  const s = r.s
  const tone =
    s.error ? "bg-failed/40 border-failed/60"
    : r.shut ? "bg-muted-foreground/8 border-muted-foreground/30"
    : s.kind === "session" ? (r.run ? "bg-llm/20 border-llm/60" : "bg-llm/35 border-llm/60")
    : s.kind === "tool" ? (r.run ? "bg-tool/20 border-tool/60" : "bg-tool/35 border-tool/60")
    : "bg-linear-to-r from-muted-foreground/26 to-muted-foreground/10 border-muted-foreground/30"
  return cn(
    "absolute min-w-[3px] overflow-hidden rounded-[3px] border",
    s.kind === "tool" ? "top-[9px] h-[9px]" : "top-2 h-[11px]",
    tone,
    r.run && !s.error && "animate-pulse motion-reduce:animate-none",
    r.approx && "border-dashed border-foreground/55",
  )
}

function Label({ r, a, b }: { r: Row; a: number; b: number }) {
  const s = r.s
  const bits = s.kind === "group" ? [`${s.children.length} × ${dur(s.children.reduce((x, c) => x + c.realMs, 0))}`] : [dur(s.realMs)]
  if (s.kind !== "tool" && s.cost > 0) bits.push(money(s.cost))
  // After the bar; near the right edge, inside a wide bar or before a narrow one.
  const inside = b > 0.8 && b - a > 0.2
  const style =
    b <= 0.8 ? { left: `calc(${b * 100}% + 7px)` } : inside ? { right: `calc(${(1 - b) * 100}% + 7px)` } : { right: `calc(${(1 - a) * 100}% + 7px)` }
  return (
    <span
      className={cn("pointer-events-none absolute z-[2] top-1/2 flex -translate-y-1/2 items-center gap-1.5 font-mono text-[11px] whitespace-nowrap", inside ? "text-foreground" : "text-muted-foreground")}
      style={style}
    >
      {bits.join(" · ")}
      {s.slowest && <b className="rounded border border-needs-you/40 bg-needs-you/14 px-1 text-[9px] leading-[14px] font-bold tracking-wider text-needs-you">SLOWEST</b>}
      {r.run && <i className="size-[9px] animate-spin rounded-full border-[1.5px] border-consult/25 border-t-consult motion-reduce:animate-none" />}
    </span>
  )
}

function Card({
  r,
  tr,
  runId,
  pos,
  onClose,
  onOpenSession,
  cardRef,
}: {
  r: Row
  tr: TraceData
  runId: string
  pos: { left: number; top: number } | null
  onClose: () => void
  onOpenSession: (name: string) => void
  cardRef: Ref<HTMLDivElement>
}) {
  const s = r.s
  const kind = s.kind === "session" ? "LLM call" : s.kind === "tool" ? "Tool call" : s.kind === "stage" ? "Stage" : "Group"
  const sub = s.kind === "tool" ? "" : s.sub
  const state = s.error ? "error" : r.run ? "running" : s.running ? "ended" : "done"
  const startReal = realAt(tr, s.t0)
  const at = tr.t0ts ? hhmm(new Date(Date.parse(tr.t0ts) + startReal).toISOString()) : ""
  const kv: [string, string | number, string?][] = [["DURATION", dur(s.realMs)], ["STARTED", `+${dur(startReal)}`, at], ["COST", s.kind === "tool" ? "–" : money(s.cost)]]
  if (s.kind !== "tool") kv.push(["TOKENS IN", toks(s.tokensIn)], ["TOKENS OUT", toks(s.tokensOut)])
  if (s.children.length) kv.push(["SPANS", s.children.length])
  const file = s.kind === "session" ? sessionFile(s.ref?.transcript) : null
  const [text, setText] = useState<{ file: string; input?: string; output?: string; error?: string } | null>(null)
  useEffect(() => {
    if (!file) return
    let gone = false
    fetch(`/api/run/${encodeURIComponent(runId)}/session/${encodeURIComponent(file)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((j) => !gone && setText({ file, ...io(j.text) }))
      .catch((e) => !gone && setText({ file, error: `Transcript not available (${e.message})` }))
    return () => {
      gone = true
    }
  }, [file, runId])
  const got = text && text.file === file ? text : null

  const block = (label: string, body: string) => (
    <div className="mt-2.5" key={label}>
      <span className="font-mono text-[9.5px] tracking-widest text-muted-foreground">{label}</span>
      <p className="mt-0.5 max-h-[118px] overflow-auto text-[12.5px] leading-normal break-words whitespace-pre-wrap text-muted-foreground">{body}</p>
    </div>
  )
  let ioBlocks: ReactNode = null
  if (file) ioBlocks = !got ? block("INPUT", "Loading the transcript…") : got.error ? block("TRANSCRIPT", got.error) : [block("INPUT", got.input!), block("OUTPUT", got.output!)]
  else if (s.kind === "session") ioBlocks = block("TRANSCRIPT", r.run ? "Written when the session ends." : "None recorded for this session.")
  else if (s.kind === "tool" && s.sub) ioBlocks = block("INPUT", s.sub)

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-label="Span details"
      className="absolute z-20 w-[min(350px,calc(100vw-48px))] cursor-default rounded-xl border bg-popover px-3.5 pt-3 pb-3.5 text-popover-foreground shadow-2xl shadow-black/60"
      style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden", left: 0, top: 0 }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5">
          <Icon s={s} />
        </span>
        <div className="min-w-0 flex-1">
          <b className="block truncate text-sm font-semibold">{nameOf(s)}</b>
          <span className="block truncate font-mono text-[11px] text-muted-foreground">
            {kind}
            {sub ? ` · ${sub}` : ""}
          </span>
        </div>
        <Pill status={state} />
        <button type="button" onClick={onClose} aria-label="Close" className="grid size-[22px] flex-none place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
          <X className="size-3.5" />
        </button>
      </div>
      <div className="mt-2.5 grid grid-cols-3 gap-x-2 gap-y-2.5 rounded-lg border bg-background px-3 py-2.5">
        {kv.map(([k, v, small]) => (
          <div key={k} className="min-w-0">
            <span className="font-mono text-[9.5px] tracking-widest text-muted-foreground">{k}</span>
            <b className="block truncate text-[15px] leading-snug font-medium tabular-nums">{v}</b>
            {small && <small className="block font-mono text-[10px] text-muted-foreground">{small}</small>}
          </div>
        ))}
      </div>
      {ioBlocks}
      {file && (
        <button type="button" onClick={() => onOpenSession(file)} className="mt-3 font-mono text-[11px] text-llm underline-offset-2 hover:underline">
          ↗ open the full transcript
        </button>
      )}
    </div>
  )
}

/** The Trace tab. `live` is the run's own flag: a trace that never ended on a dead run shows as Ended. */
export default function Trace({ runId, events, live, idea }: { runId: string; events: Ev[]; live: boolean; idea?: string }) {
  const tr = useMemo(() => buildTrace(events, { breakMs: BREAK }), [events])
  const approx = useMemo(() => new Set(events.filter((e) => e?.approx && e.type === "stage.start").map((e) => String(e.stage))), [events])
  const [open, setOpen] = useState<Map<string, boolean>>(() => new Map())
  const [sel, setSel] = useState<string | null>(null)
  const [session, setSession] = useState<string | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const rowEls = useRef(new Map<string, HTMLDivElement>())

  const rows = useMemo(() => flatten(tr.spans, open, approx, live), [tr, open, approx, live])
  const selRow = sel ? rows.find((r) => r.key === sel) ?? null : null
  const sc = scale(tr.endT)
  const D = sc.D
  const pct = (t: number) => `${(Math.max(0, Math.min(t, D)) / D) * 100}%`
  const status: Status = tr.status === "live" && !live ? "ended" : tr.status
  const wall = tr.t0ts ? events.reduce((m, e) => Math.max(m, Date.parse(e?.ts) || 0), 0) - Date.parse(tr.t0ts) : 0

  // Anchor the card under the clicked row's bar, inside the visible part of the panel; above it near the bottom.
  useLayoutEffect(() => {
    const inner = innerRef.current, card = cardRef.current, el = sel ? rowEls.current.get(sel) : null
    if (!sel || !inner || !card || !el) return setPos(null)
    const scr = inner.closest<HTMLElement>("[data-slot=scroll-area-viewport]") ?? inner.parentElement!
    const box = inner.getBoundingClientRect()
    const bar = (el.querySelector("[data-bar]") ?? el).getBoundingClientRect(), rr = el.getBoundingClientRect()
    const w = card.offsetWidth, h = card.offsetHeight
    const minL = scr.scrollLeft + 8, maxL = scr.scrollLeft + scr.clientWidth - w - 8
    const left = Math.max(minL, Math.min(bar.left - box.left, maxL))
    let top = rr.bottom - box.top + 4
    if (top + h > scr.scrollTop + scr.clientHeight && rr.top - box.top - h - 4 >= scr.scrollTop) top = rr.top - box.top - h - 4
    setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }))
  })
  // A selection whose row went away (collapsed parent) closes the card.
  useEffect(() => {
    if (sel && !selRow) setSel(null)
  }, [sel, selRow])
  useEffect(() => {
    if (!sel) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !session && setSel(null)
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (!t.closest?.("[data-trace-row]") && !cardRef.current?.contains(t) && !session) setSel(null)
    }
    document.addEventListener("keydown", onKey)
    document.addEventListener("mousedown", onDown)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("mousedown", onDown)
    }
  }, [sel, session])

  const toggle = (r: Row) =>
    setOpen((m) => {
      const n = new Map(m)
      n.set(r.key, r.shut)
      return n
    })

  const breaks = tr.breaks.map((b, i) => (
    <i
      key={`b${i}`}
      className="absolute top-0 bottom-0 min-w-1.5 border-x bg-[repeating-linear-gradient(135deg,color-mix(in_srgb,var(--muted-foreground)_26%,transparent)_0_2px,transparent_2px_5px)]"
      style={{ left: pct(b.t), width: `${(BREAK / D) * 100}%` }}
    />
  ))

  return (
    <TooltipProvider delay={150}>
      <div className="flex h-[calc(100vh-15rem)] min-h-[420px] flex-col overflow-hidden rounded-xl border bg-card [--namew:330px] [--padr:112px] max-md:[--namew:190px] max-md:[--padr:92px]">
        <div className="flex min-w-0 items-center gap-2.5 px-4 pt-3">
          <b className="flex-none font-mono text-[13px] font-bold">Trace</b>
          <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{tr.title || idea || runId}</span>
          {approx.size > 0 && <span className="flex-none font-mono text-[11px] text-muted-foreground italic">approx. from file times</span>}
          <Pill status={status} />
        </div>
        <Stats tr={tr} wall={wall} />
        <ScrollArea className="min-h-0 flex-1" horizontal>
          <div ref={innerRef} className="relative min-w-[calc(var(--namew)+560px)] pb-7">
            {/* axis: ticks, markers, breaks, playhead */}
            <div className="sticky top-0 z-30 grid h-[30px] grid-cols-[var(--namew)_minmax(0,1fr)] border-b bg-card">
              <div className="sticky left-0 z-10 flex items-center border-r bg-card pl-4 font-mono text-[10px] tracking-widest text-muted-foreground">SPAN</div>
              <div className="relative mr-[var(--padr)] ml-3">
                {tr.breaks.map((b, i) => (
                  <Tip
                    key={`ab${i}`}
                    tip={`${b.reason === "waiting" ? "waiting on you" : "idle"} ${dur(b.realMs)}`}
                    style={{ left: pct(b.t), width: `${(BREAK / D) * 100}%` }}
                    className="absolute bottom-0 h-3 min-w-1.5 cursor-help border-x bg-[repeating-linear-gradient(135deg,color-mix(in_srgb,var(--muted-foreground)_26%,transparent)_0_2px,transparent_2px_5px)]"
                  >
                    <span className="sr-only">break</span>
                  </Tip>
                ))}
                {Array.from({ length: sc.n + 1 }, (_, k) => (
                  <span key={`t${k}`} className={cn("absolute top-2 font-mono text-[10.5px] whitespace-nowrap text-muted-foreground/80", k > 0 && "-translate-x-1/2")} style={{ left: `${(k / sc.n) * 100}%` }}>
                    {tick(k * sc.step)}
                  </span>
                ))}
                {tr.markers.map((m, i) =>
                  MARK[m.kind] ? (
                    <Tip
                      key={`m${i}`}
                      tip={`${MARK[m.kind]}${m.stage ? ` (${m.stage})` : ""}: ${m.label}`}
                      style={{ left: pct(m.t) }}
                      className={cn(
                        "absolute -bottom-[5px] z-10 size-[9px] -translate-x-1/2 rotate-45 cursor-help rounded-[1px] border-[1.5px]",
                        m.kind === "error" && "border-failed bg-failed",
                        m.kind === "stop" && "border-failed bg-card",
                        m.kind === "wait" && "border-needs-you bg-needs-you",
                        m.kind === "human" && "border-consult bg-consult",
                        m.kind === "question" && "border-llm bg-llm",
                        m.kind === "gap" && "border-muted-foreground bg-card opacity-80",
                      )}
                    >
                      <span className="sr-only">{MARK[m.kind]}</span>
                    </Tip>
                  ) : null,
                )}
                <i className="pointer-events-none absolute top-0 -bottom-px w-px bg-consult" style={{ left: pct(tr.endT) }}>
                  <i className="absolute -bottom-[3px] -left-[3px] size-[7px] rounded-full bg-consult" />
                </i>
              </div>
            </div>
            {/* break hatches under the rows, playhead over them */}
            <div className="pointer-events-none absolute top-[30px] right-[var(--padr)] bottom-0 left-[calc(var(--namew)+12px)] z-0">{breaks}</div>
            <div className="relative">
              {rows.length === 0 ? (
                <div className="px-4 py-14 text-center font-mono text-[13px] text-muted-foreground">No spans yet. Stages, sessions and tool calls show here as the run reaches them.</div>
              ) : (
                rows.map((r) => {
                  const s = r.s
                  const a = Math.max(0, s.t0) / D, b = Math.min(s.t1, D) / D
                  const on = sel === r.key
                  return (
                    <div
                      key={r.key}
                      data-trace-row
                      ref={(el) => {
                        if (el) rowEls.current.set(r.key, el)
                        else rowEls.current.delete(r.key)
                      }}
                      onClick={() => setSel(on ? null : r.key)}
                      className={cn("group grid h-[27px] cursor-pointer grid-cols-[var(--namew)_minmax(0,1fr)] hover:bg-muted/60", on && "bg-muted/60")}
                    >
                      <div
                        className={cn("sticky left-0 z-[2] flex min-w-0 items-center gap-1.5 border-r bg-card pr-2.5 text-[12.5px] group-hover:bg-muted", on && "bg-muted")}
                        style={{ paddingLeft: 10 + r.depth * 16 }}
                      >
                        <button
                          type="button"
                          aria-label={r.shut ? "Expand" : "Collapse"}
                          aria-expanded={r.kids ? !r.shut : undefined}
                          className={cn("grid size-3.5 flex-none place-items-center rounded-[3px] text-muted-foreground transition-transform hover:bg-border hover:text-foreground", !r.kids && "invisible", r.kids && !r.shut && "rotate-90")}
                          onClick={(e) => {
                            e.stopPropagation()
                            if (r.kids) toggle(r)
                          }}
                        >
                          <ChevronRight className="size-2.5" />
                        </button>
                        <Icon s={s} />
                        <span className={cn("max-w-[58%] flex-none truncate max-md:max-w-none max-md:flex-1", (s.kind === "stage" || s.kind === "group") && "font-semibold")}>{nameOf(s)}</span>
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground max-md:hidden">{s.sub}</span>
                        {r.shut && <span className="flex-none rounded border px-1 font-mono text-[10px] leading-[15px] text-muted-foreground">+{r.kids}</span>}
                        {s.error && <span className="flex-none text-[11px] text-failed" aria-label="error">⚠</span>}
                      </div>
                      <div className="relative mr-[var(--padr)] ml-3">
                        {r.approx ? (
                          <Tip bar tip="approx. from file times" className={barClass(r)} style={{ left: `${a * 100}%`, width: `${Math.max(0, b - a) * 100}%` }}>
                            {r.shut && <Mini s={s} />}
                          </Tip>
                        ) : (
                          <div data-bar className={barClass(r)} style={{ left: `${a * 100}%`, width: `${Math.max(0, b - a) * 100}%` }}>
                            {r.shut && <Mini s={s} />}
                          </div>
                        )}
                        <Label r={r} a={a} b={b} />
                      </div>
                    </div>
                  )
                })
              )}
            </div>
            <div className="pointer-events-none absolute top-[30px] right-[var(--padr)] bottom-0 left-[calc(var(--namew)+12px)] z-[1]">
              <i className="absolute top-0 bottom-0 w-px bg-consult/80" style={{ left: pct(tr.endT) }} />
            </div>
            {selRow && (
              <Card
                key={selRow.key}
                r={selRow}
                tr={tr}
                runId={runId}
                pos={pos}
                cardRef={cardRef}
                onClose={() => setSel(null)}
                onOpenSession={setSession}
              />
            )}
          </div>
        </ScrollArea>
      </div>
      <SessionSheet runId={runId} name={session} onClose={() => setSession(null)} />
    </TooltipProvider>
  )
}
