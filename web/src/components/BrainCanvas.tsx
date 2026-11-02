import { useEffect, useMemo, useRef, useState } from "react"
import { Input } from "@/components/ui/input"

export type BrainNode = {
  id: string; type: "project" | "area" | "memory"; title: string; kind?: string
  text?: string; project?: string; area?: string; guessed?: boolean; run?: string
  x: number; y: number; vx: number; vy: number
}
export type BrainData = { nodes: Omit<BrainNode, "x" | "y" | "vx" | "vy">[]; links: [string, string][] }

// Memory kind -> [legend group, colour]. Red keeps meaning "you"; hubs use the foreground colour.
const KIND: Record<string, [string, string]> = {
  human: ["you said", "#f85149"], answer: ["you said", "#f85149"], stop: ["stops", "#f85149"],
  decision: ["decisions", "#58a6ff"], "decision.final": ["decisions", "#58a6ff"],
  lesson: ["lessons", "#d29922"], "learning.approved": ["lessons", "#d29922"],
  constraint: ["constraints", "#8b949e"], architecture: ["architecture", "#a371f7"], context: ["context", "#6e7681"],
}
const GROUPS = [...new Map(Object.values(KIND)).entries()]
const groupOf = (n: BrainNode) => (n.type === "memory" ? (KIND[n.kind ?? ""]?.[0] ?? n.kind ?? "context") : n.type)
const radiusOf = (n: BrainNode) => (n.type === "project" ? 9 : n.type === "area" ? 6 : 2.4)
const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s)

type Link = { a: BrainNode; b: BrainNode }
type Model = { nodes: BrainNode[]; links: Link[]; adj: Map<string, BrainNode[]>; byId: Map<string, BrainNode> }

function build(data: BrainData): Model {
  const nodes: BrainNode[] = data.nodes.map((n) => ({ ...n, x: 0, y: 0, vx: 0, vy: 0 }))
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const links: Link[] = []
  const adj = new Map<string, BrainNode[]>()
  for (const [x, y] of data.links) {
    const a = byId.get(x), b = byId.get(y)
    if (!a || !b) continue
    links.push({ a, b })
    adj.set(a.id, [...(adj.get(a.id) ?? []), b])
    adj.set(b.id, [...(adj.get(b.id) ?? []), a])
  }
  const areas = nodes.filter((n) => n.type === "area")
  areas.forEach((p, i) => {
    const t = (i / areas.length) * Math.PI * 2
    p.x = Math.cos(t) * 220; p.y = Math.sin(t) * 220
  })
  for (const n of nodes) if (n.type === "memory") {
    const p = adj.get(n.id)?.[0]
    n.x = (p?.x ?? 0) + (Math.random() - 0.5) * 80
    n.y = (p?.y ?? 0) + (Math.random() - 0.5) * 80
  }
  return { nodes, links, adj, byId }
}

function step(m: Model, alpha: number) {
  const cell = 60, grid = new Map<string, BrainNode[]>()
  for (const n of m.nodes) {
    const k = `${Math.floor(n.x / cell)},${Math.floor(n.y / cell)}`
    const g = grid.get(k)
    g ? g.push(n) : grid.set(k, [n])
  }
  for (const n of m.nodes) {
    const cx = Math.floor(n.x / cell), cy = Math.floor(n.y / cell)
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) for (const o of grid.get(`${cx + i},${cy + j}`) ?? []) {
      if (o === n) continue
      const dx = n.x - o.x, dy = n.y - o.y, d2 = dx * dx + dy * dy || 0.01
      if (d2 > 14400) continue
      const f = (n.type === "memory" ? 18 : 60) / d2
      n.vx += dx * f; n.vy += dy * f
    }
  }
  const hubs = m.nodes.filter((n) => n.type !== "memory")
  for (const a of hubs) for (const b of hubs) if (a !== b) {
    const dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy || 1, d = Math.sqrt(d2)
    const f = (a.type === "project" && b.type === "project" ? 9000 : 900) / d2
    a.vx += (dx * f) / d; a.vy += (dy * f) / d
  }
  for (const { a, b } of m.links) {
    const len = a.type === "memory" || b.type === "memory" ? 34 : 90
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1, f = (d - len) * 0.04
    const wa = a.type === "memory" ? 1 : 0.15, wb = b.type === "memory" ? 1 : 0.15
    a.vx += (dx / d) * f * wa; a.vy += (dy / d) * f * wa; b.vx -= (dx / d) * f * wb; b.vy -= (dy / d) * f * wb
  }
  for (const n of m.nodes) {
    n.vx -= n.x * 0.002; n.vy -= n.y * 0.002
    n.x += n.vx * alpha; n.y += n.vy * alpha
    n.vx *= 0.6; n.vy *= 0.6
    if (n.type === "project") { n.x = 0; n.y = 0 }
  }
}

export function BrainCanvas({ data }: { data: BrainData }) {
  const model = useMemo(() => build(data), [data])
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const ui = useRef({ q: "", off: new Set<string>(), sel: null as BrainNode | null, hover: null as BrainNode | null })
  const [q, setQ] = useState("")
  const [off, setOff] = useState<Set<string>>(new Set())
  const [sel, setSel] = useState<BrainNode | null>(null)
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  ui.current.q = q; ui.current.off = off; ui.current.sel = sel

  useEffect(() => {
    const cv = canvas.current!, wr = wrap.current!, ctx = cv.getContext("2d")!
    const dpr = window.devicePixelRatio || 1
    const st = { w: 0, h: 0, alpha: 1, autofit: true, x: 0, y: 0, k: 1, raf: 0, drag: null as null | { x: number; y: number; vx: number; vy: number; n: BrainNode | null; moved: boolean } }
    const fit = () => {
      const r = wr.getBoundingClientRect()
      st.w = r.width; st.h = r.height
      cv.width = st.w * dpr; cv.height = st.h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    fit()
    st.x = st.w / 2; st.y = st.h / 2; st.k = Math.min(st.w, st.h) / 900
    const ro = new ResizeObserver(fit); ro.observe(wr)
    const visible = (n: BrainNode) => n.type !== "memory" || !ui.current.off.has(groupOf(n))
    const hit = (px: number, py: number) => {
      let best: BrainNode | null = null, bd = 144
      for (const n of model.nodes) {
        if (!visible(n)) continue
        const dx = st.x + n.x * st.k - px, dy = st.y + n.y * st.k - py, d = dx * dx + dy * dy
        if (d < bd) { bd = d; best = n }
      }
      return best
    }
    const frame = () => {
      const dark = document.documentElement.classList.contains("dark")
      const fg = dark ? "#ececea" : "#1f2328", edge = dark ? "255,255,255" : "0,0,0", muted = dark ? "#a3a29e" : "#59636e"
      if (st.alpha > 0.03) { step(model, st.alpha); st.alpha = Math.max(0.02, st.alpha * 0.985) }
      if (st.autofit && model.nodes.length) {
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9
        for (const n of model.nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y) }
        const k = Math.min((st.w - 120) / (x1 - x0 || 1), (st.h - 120) / (y1 - y0 || 1), 2.4)
        st.k += (k - st.k) * 0.15
        st.x += (st.w / 2 - ((x0 + x1) / 2) * st.k - st.x) * 0.15
        st.y += (st.h / 2 - ((y0 + y1) / 2) * st.k - st.y) * 0.15
      }
      const { q, sel } = ui.current, hover = ui.current.hover
      const ql = q.toLowerCase()
      const matches = (n: BrainNode) => !ql || `${n.title} ${n.text ?? ""} ${n.project ?? ""}`.toLowerCase().includes(ql)
      const focus = hover ?? sel
      const near = focus ? new Set([focus.id, ...(model.adj.get(focus.id) ?? []).map((m) => m.id)]) : null
      ctx.clearRect(0, 0, st.w, st.h)
      ctx.lineWidth = 1
      for (const { a, b } of model.links) {
        if (!visible(a) || !visible(b)) continue
        const lit = near && near.has(a.id) && near.has(b.id)
        ctx.strokeStyle = lit ? `rgba(${edge},0.55)` : near || ql ? `rgba(${edge},0.04)` : `rgba(${edge},0.12)`
        ctx.beginPath(); ctx.moveTo(st.x + a.x * st.k, st.y + a.y * st.k); ctx.lineTo(st.x + b.x * st.k, st.y + b.y * st.k); ctx.stroke()
      }
      for (const n of model.nodes) {
        if (!visible(n)) continue
        const dim = (near && !near.has(n.id)) || (ql && n.type === "memory" && !matches(n))
        const x = st.x + n.x * st.k, y = st.y + n.y * st.k, r = Math.max(1.2, radiusOf(n) * Math.sqrt(st.k))
        ctx.globalAlpha = dim ? 0.15 : 1
        ctx.fillStyle = n.type === "memory" ? (KIND[n.kind ?? ""]?.[1] ?? "#6e7681") : fg
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
        if (n === sel) { ctx.strokeStyle = fg; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, r + 4, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1 }
        if (n.type !== "memory") {
          ctx.font = '700 13px ui-monospace, Menlo, monospace'; ctx.fillStyle = fg
          ctx.fillText(n.title, x - ctx.measureText(n.title).width / 2, y - r - 8)
        } else if (n === hover) {
          ctx.font = '11px ui-monospace, Menlo, monospace'; ctx.fillStyle = muted
          ctx.fillText(short(n.title, 40), x + r + 5, y + 4)
        }
      }
      ctx.globalAlpha = 1
      st.raf = requestAnimationFrame(frame)
    }
    st.raf = requestAnimationFrame(frame)

    const pos = (e: MouseEvent) => { const r = wr.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const }
    const down = (e: MouseEvent) => { const [px, py] = pos(e); st.drag = { x: e.clientX, y: e.clientY, vx: st.x, vy: st.y, n: hit(px, py), moved: false } }
    const up = () => { if (st.drag && !st.drag.moved && st.drag.n) setSel(st.drag.n); st.drag = null }
    const move = (e: MouseEvent) => {
      const [px, py] = pos(e)
      if (st.drag) {
        const dx = e.clientX - st.drag.x, dy = e.clientY - st.drag.y
        if (Math.abs(dx) + Math.abs(dy) > 3) st.drag.moved = true
        if (st.drag.moved) { st.autofit = false; st.x = st.drag.vx + dx; st.y = st.drag.vy + dy }
        return
      }
      const n = hit(px, py)
      ui.current.hover = n
      setTip(n ? { x: px + 14, y: py + 10, text: `${n.type === "memory" ? groupOf(n) : n.type} · ${short(n.title, 90)}` } : null)
    }
    const leave = () => { ui.current.hover = null; setTip(null) }
    const wheel = (e: WheelEvent) => {
      e.preventDefault(); st.autofit = false
      const [mx, my] = pos(e)
      const k = Math.min(6, Math.max(0.2, st.k * Math.exp(-e.deltaY * 0.0015)))
      st.x = mx - (mx - st.x) * (k / st.k); st.y = my - (my - st.y) * (k / st.k); st.k = k
    }
    wr.addEventListener("mousedown", down); window.addEventListener("mouseup", up)
    wr.addEventListener("mousemove", move); wr.addEventListener("mouseleave", leave)
    wr.addEventListener("wheel", wheel, { passive: false })
    return () => {
      cancelAnimationFrame(st.raf); ro.disconnect()
      wr.removeEventListener("mousedown", down); window.removeEventListener("mouseup", up)
      wr.removeEventListener("mousemove", move); wr.removeEventListener("mouseleave", leave)
      wr.removeEventListener("wheel", wheel)
    }
  }, [model])

  const linked = sel ? (model.adj.get(sel.id) ?? []).slice(0, 40) : []
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" placeholder="Search what is remembered…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search brain" />
        {GROUPS.map(([g, c]) => (
          <button
            key={g}
            onClick={() => setOff((o) => { const n = new Set(o); n.has(g) ? n.delete(g) : n.add(g); return n })}
            className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px] ${off.has(g) ? "opacity-40" : ""}`}
          >
            <i className="size-2 rounded-full" style={{ background: c }} />
            {g}
          </button>
        ))}
      </div>
      <div className="relative">
        <div ref={wrap} className="relative h-[560px] cursor-grab overflow-hidden rounded-lg border bg-card">
          <canvas ref={canvas} className="absolute inset-0 size-full" />
          {tip && (
            <div className="pointer-events-none absolute rounded border bg-popover px-2 py-1 font-mono text-[11px] text-popover-foreground" style={{ left: tip.x, top: tip.y }}>
              {tip.text}
            </div>
          )}
        </div>
        {sel && (
          <aside className="absolute right-3 top-3 max-h-[520px] w-72 overflow-auto rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg">
            <div className="flex items-center justify-between font-mono text-[11px] text-muted-foreground">
              <span>{sel.type === "memory" ? `${groupOf(sel)} · ${sel.guessed ? "~" : ""}${sel.area ?? ""}` : sel.type}</span>
              <button onClick={() => setSel(null)} aria-label="Close">✕</button>
            </div>
            <h3 className="my-2 text-sm font-semibold">{sel.title}</h3>
            {sel.text && <p className="text-xs text-muted-foreground">{sel.text}</p>}
            {sel.run && (
              <a className="mt-2 block text-xs underline" href={`#/run/${encodeURIComponent(sel.run)}/map`}>Open the run it came from</a>
            )}
            <div className="mt-3 font-mono text-[11px] text-muted-foreground">Linked · {model.adj.get(sel.id)?.length ?? 0}</div>
            {linked.map((m) => (
              <button key={m.id} onClick={() => setSel(m)} className="block w-full truncate border-b py-1 text-left text-xs">
                {short(m.title, 60)}
              </button>
            ))}
          </aside>
        )}
      </div>
      <p className="font-mono text-[11px] text-muted-foreground">Drag to pan, scroll to zoom, click a dot to read it. Areas marked ~ are guessed from the text.</p>
    </div>
  )
}
