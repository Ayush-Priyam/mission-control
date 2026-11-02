import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/** The house panel: a card with a 40px header (sentence-case title, mono count, an aside on the right). */
export function Panel({ title, count, aside, children, className, bodyClassName, label }: { title: ReactNode; count?: number; aside?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; label?: string }) {
  return (
    <section aria-label={label} className={cn("min-w-0 rounded-xl border bg-card", className)}>
      <div className="flex min-h-10 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b px-4 py-1.5">
        <h2 className="text-sm font-medium">
          {title}
          {count !== undefined && <span className="ml-1.5 font-mono text-xs text-faint">{count}</span>}
        </h2>
        {aside}
      </div>
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  )
}

/**
 * A row of numbers in hairline cells (the item page's summary strip style). Each cell draws its own
 * hairline (a 1px ring into the 1px gap; the outer edge is clipped), so a short last row leaves card
 * colour behind it, never an empty grey cell.
 */
export function Strip({ children, label, className }: { children: ReactNode; label?: string; className?: string }) {
  return (
    <section aria-label={label} data-strip className={cn("grid gap-px overflow-hidden rounded-xl border bg-card", className)}>
      {children}
    </section>
  )
}

export function StripCell({ k, children, tip, className, sub, cellClassName }: { k: string; children: ReactNode; tip?: string; className?: string; sub?: ReactNode; cellClassName?: string }) {
  return (
    <div data-strip-cell className={cn("min-w-0 bg-card px-3 py-2.5 shadow-[0_0_0_1px_var(--border)]", cellClassName)} title={tip}>
      <div className="truncate text-xs text-muted-foreground">{k}</div>
      <div className={cn("mt-0.5 truncate text-lg font-semibold tracking-tight tabular-nums", className)}>{children}</div>
      {sub && <div className="font-mono text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}
