import { useEffect, useMemo, useState, type ReactNode } from "react"
import { CallBreakdown } from "@/components/CallBreakdown"
import { CallDetail } from "@/components/CallDetail"
import { CallList, KIND, chipCounts, filterCalls, type Chip } from "@/components/CallList"
import { useCalls, useItem, type Call, type ItemDetail, type Lane, type Status } from "@/lib/api"
import { StatusDot } from "@/components/StatusDot"
import { cn } from "@/lib/utils"
import { Plug, X, Zap } from "lucide-react"

const LIVE_POLL = 5000

const quiet = (s: string) => s === "done" || s === "idle" || s === "stopped"
const rank = (s: string) => (s === "waiting" ? 0 : s === "working" ? 1 : s === "failed" ? 2 : 3)

/** main first, then lanes that need you or are working, then the newest. */
function orderLanes(lanes: Lane[]) {
  return [...lanes].sort(
    (a, b) =>
      Number(b.kind === "main") - Number(a.kind === "main") ||
      rank(a.status) - rank(b.status) ||
      (b.startedAt ?? "").localeCompare(a.startedAt ?? ""),
  )
}

const CHIPS: Chip[] = ["all", "tool", "mcp", "skill", "agent", "errors"]
const chipLabel = (c: Chip) => (c === "all" ? "All" : c === "errors" ? "Errors" : KIND[c].label)

const enc = encodeURIComponent
const kfmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n))

type Props = {
  source: string
  id: string
  /** Where "Open session" goes for a call (default: the item's Chat tab). */
  sessionHref?: (call: Call) => string
  /** Where "Show on timeline" goes for a call (default: the item's Timeline tab). */
  timelineHref?: (call: Call) => string
  /** A call to open (from a link such as a timeline tick). */
  call?: string
  /** The item and its calls when the page already polls them (the item page): no second poller. */
  detail?: ItemDetail | null
  calls?: Call[] | null
  /** Why the given calls failed to load (shown instead of an empty list). */
  callsError?: string | null
}

/** Calls tab: lanes on the left, filtered calls in the middle, the picked call on the right. */
export default function Calls({ source, id, sessionHref, timelineHref, call, detail: given, calls: givenCalls, callsError }: Props) {
  const shared = given !== undefined
  const [poll, setPoll] = useState(0) // poll only while the item is live
  const item = useItem(source, shared ? null : id, poll)
  const fetched = useCalls(source, shared ? null : id, {}, poll)
  const live = item.data?.summary.live === true
  useEffect(() => setPoll(live ? LIVE_POLL : 0), [live])
  const detail = shared ? given : item.data
  const calls = shared ? { data: givenCalls ?? null, loading: givenCalls == null && !callsError, error: callsError ?? null } : fetched

  const [lane, setLane] = useState<string | null>(null)
  const [chip, setChip] = useState<Chip>("all")
  const [q, setQ] = useState("")
  const [picked, setPicked] = useState<string | null>(call ?? null)
  useEffect(() => {
    if (call) setPicked(call)
  }, [call])

  const all = calls.data ?? []
  const lanes = useMemo(() => orderLanes(detail?.lanes ?? []), [detail])
  const labels = useMemo(() => new Map(lanes.map((l) => [l.id, l.label])), [lanes])
  const laneLabel = (l: string) => labels.get(l) ?? l
  const perLane = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of all) m.set(c.lane, (m.get(c.lane) ?? 0) + 1)
    return m
  }, [all])

  const scoped = useMemo(() => filterCalls(all, { lane, chip: "all", q }), [all, lane, q])
  const counts = useMemo(() => chipCounts(scoped), [scoped])
  const rows = useMemo(() => filterCalls(scoped, { lane: null, chip, q: "" }).reverse(), [scoped, chip])
  const inLane = useMemo(() => (lane === null ? all : all.filter((c) => c.lane === lane)), [all, lane])
  const selected = picked ? all.find((c) => c.id === picked) ?? null : null
  const current = lane ? lanes.find((l) => l.id === lane) : undefined

  const base = `#/item/${enc(source)}/${enc(id)}`
  const toSession = sessionHref ?? (() => `${base}/chat`)
  const toTimeline = timelineHref ?? (() => `${base}/timeline`)

  if (item.error && !detail) return <div className="p-6 text-sm text-muted-foreground">Could not load this item ({item.error}).</div>
  if (calls.error && !calls.data) return <div role="alert" className="p-6 text-sm text-failed">Could not load calls ({calls.error}).</div>
  if (!detail || (calls.loading && !calls.data)) return <div className="p-6 text-sm text-muted-foreground">Loading calls…</div>

  const used = {
    skills: new Set(inLane.filter((c) => c.kind === "skill").map((c) => c.name)).size,
    servers: new Set(inLane.filter((c) => c.kind === "mcp").map((c) => c.server)).size,
  }
  const tokens = (current ? [current] : lanes).reduce((n, l) => n + (l.tokens ? l.tokens.in + l.tokens.out + l.tokens.cacheRead + l.tokens.cacheWrite : 0), 0)
  const cost = (current ? [current] : lanes).reduce((n, l) => n + (l.cost ?? 0), 0)
  const models = [...new Set((current ? [current] : lanes).map((l) => l.model).filter(Boolean))]

  return (
    <div className="grid h-full min-h-0 grid-cols-[230px_minmax(0,1fr)_380px] overflow-hidden">
      {/* lanes */}
      <div className="flex min-h-0 flex-col border-r p-3 text-sm">
        <div className="px-2 py-1 text-[11px] tracking-wide text-muted-foreground uppercase">Lanes</div>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto" role="list" aria-label="Lanes">
          <LaneRow label="All lanes" count={all.length} on={lane === null} onClick={() => setLane(null)} />
          {lanes.map((l) => (
            <LaneRow
              key={l.id}
              label={l.label}
              count={perLane.get(l.id) ?? 0}
              status={l.status}
              dim={quiet(l.status)}
              title={l.reason ?? l.status}
              on={lane === l.id}
              onClick={() => setLane(l.id)}
            />
          ))}
        </div>
        <div className="mt-3 border-t pt-3">
          <div className="truncate px-2 pb-1 text-[11px] tracking-wide text-muted-foreground uppercase">{current ? current.label : "All lanes"} · used</div>
          <div className="space-y-1.5 px-2 text-xs text-foreground/85">
            <Stat icon={<Zap className="size-3.5 text-tool" />} label="skills" value={used.skills} />
            <Stat icon={<Plug className="size-3.5 text-llm" />} label="MCP servers" value={used.servers} />
            {tokens > 0 && <Stat label="tokens" value={kfmt(tokens)} />}
            {cost > 0 && <Stat label="cost (est.)" value={`$${cost.toFixed(2)}`} />}
            {models.length > 0 && <div className="truncate text-[11px] text-muted-foreground" title={models.join(", ")}>{models.join(", ")}</div>}
          </div>
        </div>
      </div>

      {/* calls */}
      <div className="flex min-h-0 flex-col p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 truncate font-semibold">
            {current ? current.label : "All lanes"}{" "}
            <span className="text-sm font-normal text-muted-foreground">
              · {inLane.length} calls{current?.model ? ` · ${current.model}` : ""}
            </span>
          </div>
          <div className="relative">
            <input
              aria-label="Search calls"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, summary or server…"
              className="h-8 w-64 rounded-md border bg-muted/40 px-3 pr-7 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring"
            />
            {q && (
              <button aria-label="Clear search" onClick={() => setQ("")} className="absolute top-2 right-2 text-muted-foreground">
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Filter calls">
          {CHIPS.map((c) => {
            const Icon = c !== "all" && c !== "errors" ? KIND[c].icon : c === "errors" ? X : null
            return (
              <button
                key={c}
                aria-pressed={chip === c}
                onClick={() => setChip(c)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
                  chip === c
                    ? "border-foreground bg-foreground text-background"
                    : c === "errors" && counts.errors > 0
                      ? "border-failed/40 text-failed hover:bg-failed/10"
                      : "hover:bg-muted",
                )}
              >
                {Icon && <Icon className="size-3.5" />}
                {chipLabel(c)} <span className="font-mono">{counts[c]}</span>
              </button>
            )
          })}
        </div>
        <div className="mt-4">
          <CallBreakdown calls={scoped} />
        </div>
        <div className="mt-4 mb-1 text-[11px] tracking-wide text-muted-foreground uppercase">
          Calls · newest first{rows.length !== scoped.length || q ? ` · ${rows.length} shown` : ""}
        </div>
        <CallList
          calls={rows}
          selectedId={picked}
          onSelect={setPicked}
          laneLabel={lane === null && lanes.length > 1 ? laneLabel : undefined}
          empty={all.length === 0 ? "No calls recorded for this item." : "No calls match."}
        />
      </div>

      {/* detail */}
      <div className="min-h-0 overflow-y-auto border-l p-4">
        {selected ? (
          <CallDetail
            call={selected}
            laneLabel={laneLabel}
            sessionHref={toSession(selected)}
            timelineHref={toTimeline(selected)}
            onClose={() => setPicked(null)}
            onOpenLane={(l) => setLane(l)}
          />
        ) : (
          <div className="pt-1 text-sm text-muted-foreground">Pick a call to see its arguments and result.</div>
        )}
      </div>
    </div>
  )
}

function LaneRow(p: { label: string; count: number; on: boolean; onClick: () => void; status?: Status; dim?: boolean; title?: string }) {
  return (
    <button
      role="listitem"
      aria-current={p.on || undefined}
      title={p.title}
      onClick={p.onClick}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left",
        p.on ? "bg-muted" : "hover:bg-muted/50",
        p.dim && !p.on && "text-muted-foreground",
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        {p.status && <StatusDot status={p.status} />}
        <span className="truncate">{p.label}</span>
      </span>
      <span className={cn("shrink-0 font-mono", !p.on && "text-muted-foreground")}>{p.count}</span>
    </button>
  )
}

function Stat({ icon, label, value }: { icon?: ReactNode; label: string; value: string | number }) {
  return (
    <div className="flex justify-between">
      <span className="flex items-center gap-1.5">
        {icon}
        {label}
      </span>
      <span className="font-mono">{value}</span>
    </div>
  )
}
