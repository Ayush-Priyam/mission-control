import { Check, Circle, CircleDot, Hand, OctagonX, Pause, type LucideIcon } from "lucide-react"
import type { Status } from "@/lib/api"

/**
 * The one status map: the word, text colour, dot fill and icon for every status, used everywhere.
 * Amber (needs-you) means "needs you" and nothing else; green means "working" and nothing else.
 * "working" is the one word for activity: an item or lane is working when its status is "working".
 */
export type StatusUi = { label: string; title: string; text: string; fill: string; border: string; icon: LucideIcon }

export const STATUS_UI: Record<Status, StatusUi> = {
  working: { label: "working", title: "Working", text: "text-running", fill: "bg-running", border: "border-running/40", icon: CircleDot },
  waiting: { label: "needs you", title: "Needs you", text: "text-needs-you", fill: "bg-needs-you", border: "border-needs-you/50", icon: Hand },
  failed: { label: "failed", title: "Failed", text: "text-failed", fill: "bg-failed", border: "border-failed/40", icon: OctagonX },
  stopped: { label: "stopped", title: "Stopped", text: "text-stopped", fill: "bg-stopped", border: "border-stopped/40", icon: Pause },
  done: { label: "done", title: "Done", text: "text-muted-foreground", fill: "bg-done", border: "border-border", icon: Check },
  idle: { label: "idle", title: "Idle", text: "text-faint", fill: "bg-transparent ring-1 ring-inset ring-done", border: "border-border", icon: Circle },
}

export const statusLabel = (s: Status) => STATUS_UI[s].label
export const statusTitle = (s: Status) => STATUS_UI[s].title
export const isWorking = (s: Status) => s === "working"

/**
 * The one header count of activity, from the live lanes: "5 lanes working · 2 items", "1 lane working
 * · 1 item", or "idle". (The Working chip counts items whose own status is working; an item waiting on
 * you can still have lanes working, so the header counts lanes.)
 */
export function workingLine(lanes: { source: string; id: string }[]): string {
  if (!lanes.length) return "idle"
  const items = new Set(lanes.map((l) => `${l.source}/${l.id}`)).size
  return `${lanes.length} lane${lanes.length === 1 ? "" : "s"} working · ${items} item${items === 1 ? "" : "s"}`
}
