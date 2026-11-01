// Types for trace.mjs, for the web page (which imports it directly).

export type SpanKind = "stage" | "session" | "tool" | "group"
export interface Span {
  id: string
  kind: SpanKind
  name: string
  sub: string
  t0: number
  t1: number
  realMs: number
  running: boolean
  error: boolean
  cost: number
  tokensIn: number
  tokensOut: number
  children: Span[]
  slowest?: boolean
  ref?: { transcript: string }
}
export interface Marker { t: number; kind: string; label: string; stage: string }
export interface Break { t: number; realMs: number; reason: "waiting" | "idle" }
export interface Trace {
  title: string
  status: "live" | "done" | "waiting" | "stopped"
  t0ts: string | null
  totals: { durationMs: number; cost: number; tokensIn: number; tokensOut: number; llmCalls: number; toolCalls: number; errors: number; waits: number }
  spans: Span[]
  markers: Marker[]
  breaks: Break[]
  endT: number
}
export function buildTrace(events: object[] | null | undefined, opts?: { breakAfterMs?: number; breakMs?: number }): Trace
export const safeSessionName: (s: unknown) => boolean
