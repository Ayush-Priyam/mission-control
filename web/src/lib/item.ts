// Readers for the item page: summary numbers, lane grouping, map status, health and findings.
// Pure functions over an ItemDetail (and its calls when loaded), so the page and its tests share them.
import type { Call, ItemDetail, Lane, Status, Tokens } from "@/lib/api"
import { crewCards, crewGraph, currentStop, nodeOf, type CrewGraph, type Hop } from "@/lib/graph"

type Ev = Record<string, any>

export const totalTokens = (t: Tokens | undefined) => (t ? t.in + t.out + t.cacheRead + t.cacheWrite : 0)

/** Share of input served from cache: cache reads over everything sent in (fresh + cache writes + reads); null with no input. */
export function cacheShare(t: Tokens | undefined): number | null {
  if (!t) return null
  const input = t.in + t.cacheRead + t.cacheWrite
  return input > 0 ? t.cacheRead / input : null
}

/** "12s", "42m", "3h 05m", "2d 4h" for a span in ms; "–" when unknown. */
export function span(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "–"
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ${String(m % 60).padStart(2, "0")}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

/** Short model name: "claude-sonnet-4-5" -> "sonnet", anything else as given. */
export const modelName = (m: string) => /opus|sonnet|haiku/i.exec(m)?.[0].toLowerCase() ?? m

/** Every cost on the item page is an estimate at API list prices (ruling V9). */
export const EST_TIP = "Estimate at API list prices; subscription plans differ"
export function estCost(n: number | null | undefined): string {
  if (!n || !Number.isFinite(n)) return "–"
  return `${n < 0.01 ? "<$0.01" : `$${n < 100 ? n.toFixed(2) : Math.round(n).toLocaleString("en-US")}`} est.`
}

export type Summary = {
  status: Status
  running: number
  lanes: { total: number; main: number; subagents: number; stages: number; done: number }
  durationMs: number | null
  calls: number
  errors: number
  tokens: number
  cache: number | null
  cost: number
  models: string[]
}

/** The numbers in the summary strip. A live item's duration runs to `now`. */
export function summarize(d: ItemDetail, now = Date.now()): Summary {
  const s = d.summary
  const lanes = d.lanes ?? []
  const start = s.startedAt ? Date.parse(s.startedAt) : NaN
  const end = s.live ? now : s.updatedAt ? Date.parse(s.updatedAt) : NaN
  const models = [...new Set(lanes.map((l) => l.model).filter((m): m is string => !!m).map(modelName))]
  return {
    status: s.status,
    running: lanes.filter((l) => l.status === "working").length,
    lanes: {
      total: lanes.length,
      main: lanes.filter((l) => l.kind === "main").length,
      subagents: lanes.filter((l) => l.kind === "subagent").length,
      stages: lanes.filter((l) => l.kind === "stage" || l.kind === "crew").length,
      done: lanes.filter((l) => l.status === "done").length,
    },
    durationMs: Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null,
    calls: s.counts?.calls ?? 0,
    errors: s.counts?.errors ?? 0,
    tokens: totalTokens(s.tokens),
    cache: cacheShare(s.tokens),
    cost: s.cost ?? 0,
    models,
  }
}

const ACTIVE: Record<Status, number> = { waiting: 0, working: 1, failed: 2, stopped: 3, idle: 4, done: 5 }

/** Lanes that need you or are working first, then failed/stopped, then the rest; newest first within a rank. */
export const byActivity = (a: Lane, b: Lane) =>
  ACTIVE[a.status] - ACTIVE[b.status] || (b.nowDoing?.ts ?? b.startedAt ?? "").localeCompare(a.nowDoing?.ts ?? a.startedAt ?? "")

export type LaneGroup = { lane: Lane; children: Lane[] }

/** Top-level lanes (in their own order, main first) with their subagents nested under them, busiest first. */
export function laneTree(lanes: Lane[]): LaneGroup[] {
  const ids = new Set(lanes.map((l) => l.id))
  const top = lanes.filter((l) => !l.parent || !ids.has(l.parent) || l.parent === l.id)
  const kids = new Map<string, Lane[]>()
  for (const l of lanes) if (!top.includes(l)) kids.set(l.parent!, [...(kids.get(l.parent!) ?? []), l])
  const ordered = [...top.filter((l) => l.kind === "main"), ...top.filter((l) => l.kind !== "main")]
  return ordered.map((lane) => ({ lane, children: (kids.get(lane.id) ?? []).sort(byActivity) }))
}

/** The status a map node shows for the lanes (stages) it stands for. A non-owner stop stays `stopped`, never `failed`. */
export function nodeStatus(statuses: Status[]): Status {
  if (!statuses.length) return "idle"
  for (const s of ["waiting", "working", "failed", "stopped"] as Status[]) if (statuses.includes(s)) return s
  if (statuses.every((s) => s === "done")) return "done"
  return statuses.includes("done") && statuses.every((s) => s === "done" || s === "idle") ? "done" : "idle"
}

export type Chip = { kind: "sendback" | "consult" | "waiting" | "stopped"; text: string }
export type LaneExtra = { rounds: number; chip: Chip | null; skipped: boolean }

/** A run's graph (its own `state.graph`, or the stages in a row), or null for an item with no run events. */
export function runGraph(d: ItemDetail): CrewGraph | null {
  const events = Array.isArray(d.events) ? d.events : []
  if (!d.state && !events.length) return null
  const g = crewGraph(d.state ?? {}, events)
  return g.nodes.length ? g : null
}

/**
 * Per lane: rounds, why it is working (a fresh send-back or question into it, from the run's events),
 * and whether its stage was skipped. A waiting or stopped lane's reason wins over a hop.
 */
export function laneExtras(d: ItemDetail): Map<string, LaneExtra> {
  const out = new Map<string, LaneExtra>()
  const state = d.state ?? {}
  const events: Ev[] = Array.isArray(d.events) ? d.events : []
  const g = runGraph(d)
  const cards = g ? crewCards(g, state, events, d.summary.live, currentStop(state, events)) : []
  for (const lane of d.lanes ?? []) {
    const node = g ? nodeOf(g, lane.id) : null
    const card = node ? cards.find((c) => c.node.id === node.id) : undefined
    const st = state.stages?.[lane.id]
    const rounds = Number(st?.rounds) || (card?.rounds ?? 0)
    let chip: Chip | null = null
    if (lane.status === "waiting") chip = { kind: "waiting", text: lane.reason ?? "waiting on you" }
    else if (lane.status === "stopped" && lane.reason) chip = { kind: "stopped", text: lane.reason }
    else if (card?.chip) chip = { kind: card.chip.kind, text: card.chip.kind === "consult" ? `answering ${card.chip.text}` : card.chip.text.replace(/ · /, " · from ") }
    else if (lane.reason) chip = { kind: "waiting", text: lane.reason }
    out.set(lane.id, { rounds, chip, skipped: st?.status === "skipped" })
  }
  return out
}

export type Finding = { tone: "failed" | "consult" | "needs-you"; text: string; lane?: string; ts?: string }

/** What went wrong or was asked: issues, send-backs, questions (run events), else failed calls. Newest last. */
export function findings(d: ItemDetail, calls: Call[] = []): Finding[] {
  const out: Finding[] = []
  const events: Ev[] = Array.isArray(d.events) ? d.events : []
  for (const e of events) {
    const id = typeof e.id === "string" && e.id ? `${e.id} ` : ""
    if (e.type === "issue") {
      const owner = e.decision?.owner && e.decision.owner !== e.stage ? ` → sent back to ${e.decision.owner}` : ""
      out.push({ tone: "failed", text: `${id}${String(e.summary ?? e.detail ?? e.title ?? e.text ?? "issue")}${owner}`, lane: e.stage, ts: e.ts })
    } else if (e.type === "consult.asked") {
      out.push({ tone: "consult", text: `${id}${String(e.question ?? e.detail ?? "question")} (${e.from ?? e.stage ?? "?"} asked ${e.to ?? "?"})`, lane: e.to, ts: e.ts })
    } else if (e.type === "stage.end" && e.ok === false) {
      out.push({ tone: "failed", text: `${e.stage ?? "stage"} failed${e.reason ? `: ${e.reason}` : ""}`, lane: e.stage, ts: e.ts })
    }
  }
  if (!events.length) {
    for (const c of calls) if (c.ok === false || c.error) out.push({ tone: "failed", text: `${c.name}: ${c.error ?? c.result ?? c.summary}`, lane: c.lane, ts: c.ts })
  }
  return out
}

export type Health = {
  /** Share of calls that did not fail (null with no calls). */
  okRate: number | null
  errors: number
  calls: number
  sendBacks: number
  consults: number
  /** Extra rounds beyond the first, over all stages. */
  rework: number
  cache: number | null
  budget: { spent: number; limit: number } | null
}

const sendBacks = (hops: Hop[]) => hops.filter((h) => h.kind === "sendback").length

export function health(d: ItemDetail, calls: Call[] | null = null): Health {
  const s = d.summary
  const g = runGraph(d)
  const hops = g?.hops ?? []
  // A run counts its issues as errors (its calls carry no outcome); a session counts its failed calls.
  const isRun = Array.isArray(d.events) && d.events.length > 0
  const failedCalls = calls && !isRun ? calls.filter((c) => c.ok === false || !!c.error).length : null
  const nCalls = calls ? calls.length : (s.counts?.calls ?? 0)
  const errors = failedCalls ?? (s.counts?.errors ?? 0)
  const stages: Record<string, any> = d.state?.stages ?? {}
  const rework = Object.values(stages).reduce((n: number, st: any) => n + Math.max(0, (Number(st?.rounds) || 0) - 1), 0)
  const limit = Number(d.state?.budget?.usd ?? d.state?.budget?.limit ?? d.state?.budgetUsd)
  return {
    okRate: nCalls > 0 ? Math.max(0, 1 - errors / nCalls) : null,
    errors,
    calls: nCalls,
    sendBacks: sendBacks(hops),
    consults: hops.filter((h) => h.kind === "consult").length,
    rework,
    cache: cacheShare(s.tokens),
    budget: Number.isFinite(limit) && limit > 0 ? { spent: s.cost ?? 0, limit } : null,
  }
}

/** The run's open stop for the needs-you card, from the shared rule; null when nothing is stopped. */
export function openStopOf(d: ItemDetail) {
  const events: Ev[] = Array.isArray(d.events) ? d.events : []
  return events.length ? currentStop(d.state ?? {}, events) : null
}
