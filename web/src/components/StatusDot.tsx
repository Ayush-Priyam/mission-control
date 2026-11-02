import type { Status } from "@/lib/api"
import { cn } from "@/lib/utils"

/** Fill colour per status (globals.css tokens). */
export const STATUS_BG: Record<Status, string> = {
  working: "bg-running",
  waiting: "bg-needs-you",
  failed: "bg-failed",
  stopped: "bg-stopped",
  done: "bg-done",
  idle: "bg-done/60",
}
export const STATUS_TEXT: Record<Status, string> = {
  working: "text-running",
  waiting: "text-needs-you",
  failed: "text-failed",
  stopped: "text-stopped",
  done: "text-muted-foreground",
  idle: "text-faint",
}
export const STATUS_LABEL: Record<Status, string> = {
  working: "working",
  waiting: "needs you",
  failed: "failed",
  stopped: "stopped",
  done: "done",
  idle: "idle",
}

/** A status dot: pulses while working (or when `live`), carries a halo when it needs you. */
export function StatusDot({ status, live, className }: { status: Status; live?: boolean; className?: string }) {
  return (
    <i
      aria-label={STATUS_LABEL[status]}
      className={cn(
        "inline-block size-2 shrink-0 rounded-full not-italic",
        STATUS_BG[status],
        (status === "working" || (live && status !== "waiting")) && "mc-pulse",
        status === "waiting" && "mc-glow",
        className,
      )}
    />
  )
}
