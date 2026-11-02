import type { ReactNode } from "react"

/** The one floating value label of a chart: shown over the hovered or focused mark (keyboard and pointer alike). */
export function ChartTip({ at, children }: { at: { x: number; y: number } | null; children: ReactNode }) {
  if (!at) return null
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border bg-popover px-2 py-1 font-mono text-xs whitespace-nowrap text-popover-foreground shadow-md"
      style={{ left: at.x, top: at.y - 6 }}
    >
      {children}
    </div>
  )
}

/** Where a mark sits inside its positioned chart container (centre-top). */
export function tipAt(el: HTMLElement | null, box: HTMLElement | null): { x: number; y: number } | null {
  if (!el || !box) return null
  const a = el.getBoundingClientRect()
  const b = box.getBoundingClientRect()
  return { x: a.left - b.left + a.width / 2, y: a.top - b.top }
}
