// Small readers for run events, shared by the thread, the map's sheet and the agent view.

type Ev = Record<string, any>

export const hhmm = (ts: unknown) => {
  const d = new Date(String(ts ?? ""))
  return Number.isFinite(d.getTime()) ? d.toTimeString().slice(0, 5) : "--:--"
}

export const short = (s: unknown, n = 70) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim()
  return t.length > n ? t.slice(0, n - 1) + "…" : t
}

const base = (p: unknown) => String(p ?? "").split("/").filter(Boolean).pop() ?? ""

/** Events that concern any of `stages`: its own, plus send-backs and questions aimed at it. */
export function stageEvents(events: Ev[], stages: string[]): Ev[] {
  const has = (s: unknown) => typeof s === "string" && stages.includes(s)
  return events.filter(
    (e) =>
      has(e.stage) ||
      (e.type === "issue" && has(e.decision?.owner)) ||
      (typeof e.type === "string" && e.type.startsWith("consult.") && (has(e.from) || has(e.to))),
  )
}

const tok = (t: any) => {
  const n = (t?.input_tokens ?? 0) + (t?.cache_creation_input_tokens ?? 0) + (t?.output_tokens ?? 0)
  return n ? `${Math.round(n / 1000)}k tok` : ""
}

/** What a progress event did, in words (ported from the old page's crew feed). */
export function progressText(e: Ev): string {
  const tool = e.tool
  if (!tool || tool === "session") return short(e.detail, 90)
  if (tool === "Bash" || tool === "command") return `ran ${short(e.detail, 60)}`
  if (tool === "Read") return `read ${base(e.detail)}`
  if (tool === "Edit" || tool === "Write" || tool === "MultiEdit") return `edited ${base(e.detail)}`
  if (tool === "Grep" || tool === "Glob") return `searched ${short(e.detail, 40)}`
  if (String(tool).startsWith("mcp__")) return String(tool).split("__").pop()!.replace(/_/g, " ")
  return `${tool} ${short(e.detail, 40)}`
}

export type Tone = "" | "good" | "bad" | "stop" | "consult" | "me"

/** One event as a single log line: who did what. */
export function eventLine(e: Ev): { who: string; text: string; tone: Tone } {
  const who = String(e.stage ?? "run")
  switch (e.type) {
    case "run.start": return { who: "run", text: `started${e.idea ? `: ${short(e.idea, 120)}` : ""}`, tone: "" }
    case "run.resume": return { who: "run", text: "resumed", tone: "" }
    case "run.end": return { who: "run", text: `ended${e.status ? ` (${e.status})` : e.ok === false ? " (failed)" : ""}`, tone: e.ok === false ? "bad" : "good" }
    case "stage.start": return { who, text: e.attempt > 1 ? `started (attempt ${e.attempt})` : "started", tone: "" }
    case "stage.end": return e.ok === false ? { who, text: `failed: ${short(e.reason, 120)}`, tone: "bad" } : { who, text: "done", tone: "good" }
    case "stage.skipped": return { who, text: `skipped: ${short(e.reason, 100)}`, tone: "" }
    case "progress": return { who, text: progressText(e), tone: "" }
    case "session": {
      const bits = [e.transcript, e.model, tok(e.tokens), e.cost ? `$${Number(e.cost).toFixed(2)}` : ""].filter(Boolean)
      return { who, text: `session ${bits.join(" · ")}`, tone: "" }
    }
    case "check": return { who, text: `check ${e.exitCode === 0 ? "passed" : "failed"}${e.cmd ? `: ${short(e.cmd, 60)}` : ""}`, tone: e.exitCode === 0 ? "good" : "bad" }
    case "issue": {
      const what = short(e.summary ?? e.title, 120)
      const owner = e.decision?.owner === "human" ? "you" : e.decision?.owner
      return e.decision?.blocks && owner && e.decision.owner !== e.stage
        ? { who, text: `sent back to ${owner}${e.id ? ` (${e.id})` : ""}: ${what}`, tone: "bad" }
        : { who, text: `raised${e.id ? ` ${e.id}` : ""}: ${what}`, tone: "" }
    }
    case "stop": return { who: String(e.stage ?? "run"), text: `stopped (${e.rule ?? "stop"}): ${short(e.detail, 160)}`, tone: "stop" }
    case "human.input": return { who: `you${e.role ? `, as ${e.role}` : ""}`, text: short(e.text, 200), tone: "me" }
    case "consult.asked": return { who: String(e.from ?? who), text: `asks ${e.to}${e.id ? ` ${e.id}` : ""}: ${short(e.question, 140)}`, tone: "consult" }
    case "consult.answered": return { who: String(e.to ?? e.from ?? who), text: `answered${e.id ? ` ${e.id}` : ""}: ${short(e.answer, 140)}`, tone: "consult" }
    case "qa": {
      const rows: any[] = Array.isArray(e.rows) ? e.rows : []
      return { who: "qa", text: `report: ${rows.filter((r) => r.status === "pass").length} pass, ${rows.filter((r) => r.status === "fail").length} fail`, tone: "good" }
    }
    default: return { who, text: [e.type, short(e.detail ?? e.summary ?? e.text, 100)].filter(Boolean).join(": "), tone: "" }
  }
}

export const TONE_CLASS: Record<Tone, string> = {
  "": "",
  good: "text-running",
  bad: "text-failed",
  stop: "text-needs-you",
  consult: "text-consult",
  me: "text-foreground",
}
