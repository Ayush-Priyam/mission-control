// An item's lanes and calls on one time axis: a row per lane (main first, then sub-agents by start), its
// session bar from first to last timestamp, and a tick per call. Idle gaps longer than `gapMs` fold to a
// short hatched break so a session resumed days later still reads. Pure, so it is tested without a browser.
import type { Call, Lane } from "@/lib/api"

export type TickKind = "tool" | "mcp" | "skill" | "agent" | "error"
export type Tick = { call: Call; x: number; kind: TickKind }
/** `a`/`b`: the bar's start and end on the axis (0..1); null when the lane has no timestamps at all. */
export type TlRow = { lane: Lane; a: number | null; b: number | null; ticks: Tick[]; running: boolean; realMs: number }
export type TlBreak = { x: number; w: number; realMs: number }
export type TlMark = { x: number; label: string }
export type Timeline = {
  rows: TlRow[]
  breaks: TlBreak[]
  marks: TlMark[]
  /** Real first and last instant on the axis (ms), null when nothing has a timestamp. */
  t0: number | null
  t1: number | null
  /** Time on the axis minus folded breaks. */
  activeMs: number
  /** The live edge (0..1) while the item is live. */
  playhead: number | null
}

const ms = (s: string | null | undefined) => {
  const t = s ? Date.parse(s) : NaN
  return Number.isFinite(t) ? t : null
}
const ACTIVE = new Set(["working", "waiting"])
export const tickKind = (c: Call): TickKind => (c.ok === false ? "error" : c.kind)

/** main first, then lanes by start (no start last), then id. */
function order(lanes: Lane[], first: Map<string, number>) {
  const start = (l: Lane) => ms(l.startedAt) ?? first.get(l.id) ?? Infinity
  return [...lanes].sort((x, y) => Number(y.kind === "main") - Number(x.kind === "main") || start(x) - start(y) || x.id.localeCompare(y.id))
}

const pad = (n: number) => String(n).padStart(2, "0")
function clock(t: number, withDay: boolean, withSec: boolean) {
  const d = new Date(t)
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}${withSec ? `:${pad(d.getSeconds())}` : ""}`
  return withDay ? `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${hm}` : hm
}

/** `zoom` (≥ 1): how many track widths the axis spans; marks get denser to match. */
export function buildTimeline(lanes: Lane[], calls: Call[], o: { live: boolean; now: number; gapMs?: number; zoom?: number }): Timeline {
  const zoom = Math.max(1, o.zoom ?? 1)
  const gapMs = o.gapMs ?? 10 * 60_000
  const first = new Map<string, number>(), last = new Map<string, number>()
  const points: number[] = []
  for (const c of calls) {
    const t = ms(c.ts)
    if (t === null) continue
    const end = t + Math.max(0, c.durationMs ?? 0)
    first.set(c.lane, Math.min(first.get(c.lane) ?? t, t))
    last.set(c.lane, Math.max(last.get(c.lane) ?? end, end))
    points.push(t, end)
  }
  const spans = new Map<string, { s: number; e: number; running: boolean }>()
  for (const l of lanes) {
    const running = o.live && ACTIVE.has(l.status)
    const s = ms(l.startedAt) ?? first.get(l.id) ?? null
    let e = Math.max(ms(l.endedAt) ?? -Infinity, last.get(l.id) ?? -Infinity, s ?? -Infinity)
    if (running) e = Math.max(e, o.now)
    if (s === null || !Number.isFinite(e)) continue
    spans.set(l.id, { s, e, running })
    points.push(s, e)
  }
  if (o.live && points.length) points.push(o.now)
  const rowsOf = (x: (t: number) => number): TlRow[] =>
    order(lanes, first).map((lane) => {
      const sp = spans.get(lane.id)
      const ticks = calls.flatMap((c) => {
        const t = c.lane === lane.id ? ms(c.ts) : null
        return t === null ? [] : [{ call: c, x: x(t), kind: tickKind(c) }]
      })
      return { lane, a: sp ? x(sp.s) : null, b: sp ? x(sp.e) : null, ticks, running: !!sp?.running, realMs: sp ? sp.e - sp.s : 0 }
    })
  if (!points.length) return { rows: rowsOf(() => 0), breaks: [], marks: [], t0: null, t1: null, activeMs: 0, playhead: null }

  // Fold: every gap between consecutive instants longer than gapMs becomes a break of fixed axis width.
  const pts = [...new Set(points)].sort((a, b) => a - b)
  let active = 0
  const gaps: { at: number; real: number }[] = []
  for (let i = 1; i < pts.length; i++) {
    const g = pts[i] - pts[i - 1]
    if (g > gapMs) gaps.push({ at: i, real: g })
    else active += g
  }
  const fold = Math.max(1000, active * 0.04)
  const D = Math.max(1, active + gaps.length * fold)
  // cumulative axis position (in folded ms) of every point
  const pos: number[] = [0]
  let gi = 0
  for (let i = 1; i < pts.length; i++) {
    const g = pts[i] - pts[i - 1]
    const folded = gi < gaps.length && gaps[gi].at === i
    if (folded) gi++
    pos.push(pos[i - 1] + (folded ? fold : g))
  }
  const x = (t: number) => {
    if (t <= pts[0]) return 0
    if (t >= pts[pts.length - 1]) return pos[pos.length - 1] / D
    let lo = 0, hi = pts.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (pts[mid] <= t) lo = mid
      else hi = mid
    }
    const f = (t - pts[lo]) / (pts[hi] - pts[lo] || 1)
    return (pos[lo] + f * (pos[hi] - pos[lo])) / D
  }
  const breaks = gaps.map((g) => ({ x: pos[g.at - 1] / D, w: fold / D, realMs: g.real }))
  const t0 = pts[0], t1 = pts[pts.length - 1]
  const multiDay = new Date(t0).toDateString() !== new Date(t1).toDateString()
  // Marks: the start, the far side of every break, and the end (dropped when they would crowd).
  const marks: TlMark[] = []
  const mark = (xx: number, t: number) => {
    // labels with a day are about twice as wide; keep them apart on a ~600px track
    if (marks.every((m) => Math.abs(m.x - xx) > (multiDay ? 0.18 : 0.1) / zoom)) marks.push({ x: xx, label: clock(t, multiDay, (t1 - t0) / zoom < 15 * 60_000) })
  }
  // axis position (0..1) back to real time, for the in-between marks
  const tAt = (xx: number) => {
    const p = xx * D
    let i = 1
    while (i < pos.length - 1 && pos[i] < p) i++
    const f = (p - pos[i - 1]) / (pos[i] - pos[i - 1] || 1)
    return pts[i - 1] + f * (pts[i] - pts[i - 1])
  }
  mark(0, t0)
  mark(1, t1)
  for (const g of gaps) mark(pos[g.at] / D, pts[g.at])
  const inBreak = (xx: number) => breaks.some((b) => xx >= b.x - 0.02 && xx <= b.x + b.w + 0.02)
  // in-between marks, coarse to fine: halves, quarters, then (zoomed) finer steps
  const parts = Math.max(4, Math.round(4 * zoom))
  const between = [...new Set([2, 4, parts].flatMap((n) => Array.from({ length: n - 1 }, (_, k) => (k + 1) / n)))]
  for (const xx of between) if (pts.length > 1 && !inBreak(xx)) mark(xx, tAt(xx))
  marks.sort((a, b) => a.x - b.x)
  return { rows: rowsOf(x), breaks, marks, t0, t1, activeMs: active, playhead: o.live ? x(o.now) : null }
}
