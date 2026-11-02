import type { Status } from "@/lib/api"
import { STATUS_UI } from "@/lib/status-ui"
import { cn } from "@/lib/utils"

const pick = <K extends "fill" | "text" | "label">(k: K) =>
  Object.fromEntries(Object.entries(STATUS_UI).map(([s, u]) => [s, u[k]])) as Record<Status, string>

/** Fill colour per status (from the one status map). */
export const STATUS_BG = pick("fill")
export const STATUS_TEXT = pick("text")
export const STATUS_LABEL = pick("label")

/**
 * A status dot: pulses while working (or when `live`), carries a halo when it needs you. Idle is an
 * outline, so done and idle differ by shape too; the Mono theme gives every status its own shape
 * (globals.css, `[data-shapes]`). `labelled`: a text label sits next to it, so the dot is hidden from
 * screen readers; otherwise it is an image named by its status.
 */
export function StatusDot({ status, live, labelled, className }: { status: Status; live?: boolean; labelled?: boolean; className?: string }) {
  return (
    <i
      role={labelled ? undefined : "img"}
      aria-hidden={labelled || undefined}
      aria-label={labelled ? undefined : STATUS_UI[status].label}
      data-status={status}
      className={cn(
        "mc-dot inline-block size-2 shrink-0 rounded-full not-italic",
        STATUS_BG[status],
        (status === "working" || (live && status !== "waiting")) && "mc-pulse",
        status === "waiting" && "mc-glow",
        className,
      )}
    />
  )
}
