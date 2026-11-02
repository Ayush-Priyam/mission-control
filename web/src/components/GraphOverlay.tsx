import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { Maximize2, Minus, Plus, X } from "lucide-react"

const MIN_K = 0.2
const MAX_K = 4

/** The button that opens a graph full screen (top-right of the flow strip and the Map panel). */
export function ExpandButton({ onClick, label = "Expand to full screen" }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="grid size-7 place-items-center rounded-md border bg-card text-muted-foreground hover:bg-accent hover:text-foreground">
      <Maximize2 className="size-3.5" />
    </button>
  )
}

/** Next zoom for a step (×2 / ÷2), clamped. */
export const stepZoom = (k: number, dir: 1 | -1) => Math.min(MAX_K, Math.max(MIN_K, dir > 0 ? k * 2 : k / 2))

/** The zoom and offset that fit content (cw × ch) into a viewport (vw × vh), centred, never above 1.5×. */
export function fitView(cw: number, ch: number, vw: number, vh: number, pad = 32) {
  const k = Math.max(MIN_K, Math.min(1.5, (vw - pad * 2) / Math.max(1, cw), (vh - pad * 2) / Math.max(1, ch)))
  return { k, x: (vw - cw * k) / 2, y: (vh - ch * k) / 2 }
}

/**
 * A graph in a full-viewport overlay: Esc or ✕ closes it, Tab stays inside, focus returns to the opener.
 * Pan by dragging, zoom with the wheel or a pinch (around the pointer) or the − / fit / + buttons.
 */
export function GraphOverlay({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDivElement>(null)
  const view = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const [t, setT] = useState({ k: 1, x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null)

  const fit = useCallback(() => {
    const v = view.current, c = content.current
    if (!v || !c) return
    setT(fitView(c.offsetWidth, c.offsetHeight, v.clientWidth, v.clientHeight))
  }, [])
  useLayoutEffect(fit, [fit])

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    close.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key !== "Tab" || !dialog.current) return
      const f = [...dialog.current.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])')].filter((el) => !el.hasAttribute("disabled"))
      if (!f.length) return
      const first = f[0], last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      } else if (!dialog.current.contains(document.activeElement)) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener("keydown", onKey, true)
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", onKey, true)
      document.body.style.overflow = prev
      opener?.focus?.()
    }
  }, [onClose])

  // A native, non-passive wheel listener so ctrl/⌘ + wheel and pinch zoom the graph, not the page.
  useEffect(() => {
    const v = view.current
    if (!v) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = v.getBoundingClientRect()
      const px = e.clientX - r.left, py = e.clientY - r.top
      setT((s) => {
        if (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaX) > 0) return { ...s, x: s.x - e.deltaX, y: s.y - e.deltaY }
        const k = Math.min(MAX_K, Math.max(MIN_K, s.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002))))
        return { k, x: px - ((px - s.x) / s.k) * k, y: py - ((py - s.y) / s.k) * k }
      })
    }
    v.addEventListener("wheel", onWheel, { passive: false })
    return () => v.removeEventListener("wheel", onWheel)
  }, [])

  const zoom = (dir: 1 | -1) => {
    const v = view.current
    const cx = (v?.clientWidth ?? 0) / 2, cy = (v?.clientHeight ?? 0) / 2
    setT((s) => {
      const k = stepZoom(s.k, dir)
      return { k, x: cx - ((cx - s.x) / s.k) * k, y: cy - ((cy - s.y) / s.k) * k }
    })
  }

  return createPortal(
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h2>
        <div className="flex items-center rounded-md border font-mono text-xs" role="group" aria-label="Zoom">
          <button type="button" aria-label="Zoom out" onClick={() => zoom(-1)} className="grid size-8 place-items-center text-muted-foreground hover:text-foreground">
            <Minus className="size-3.5" />
          </button>
          <button type="button" aria-label="Fit" onClick={fit} className="h-8 min-w-[3.5em] border-x px-2 text-muted-foreground tabular-nums hover:text-foreground">
            {`${Math.round(t.k * 100)}%`}
          </button>
          <button type="button" aria-label="Zoom in" onClick={() => zoom(1)} className="grid size-8 place-items-center text-muted-foreground hover:text-foreground">
            <Plus className="size-3.5" />
          </button>
        </div>
        <button ref={close} type="button" aria-label="Close full screen" onClick={onClose} className="grid size-8 place-items-center rounded-md border text-muted-foreground hover:bg-accent hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>
      <div
        ref={view}
        className="relative min-h-0 flex-1 cursor-grab touch-none overflow-hidden active:cursor-grabbing"
        onPointerDown={(e) => {
          if ((e.target as Element).closest("[role=button],button,a")) return
          drag.current = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y, moved: false }
          ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          d.moved = true
          setT((s) => ({ ...s, x: d.tx + e.clientX - d.x, y: d.ty + e.clientY - d.y }))
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <div ref={content} data-graph-content className="absolute top-0 left-0 origin-top-left" style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.k})` }}>
          {children}
        </div>
      </div>
      <p className="border-t px-4 py-1.5 font-mono text-xs text-faint">drag to pan · ctrl/⌘ + wheel or pinch to zoom · Esc to close</p>
    </div>,
    document.body,
  )
}
