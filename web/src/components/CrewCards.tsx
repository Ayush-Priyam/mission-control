import { useEffect, useState, type ReactNode } from "react"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { toHash } from "@/lib/route"
import type { CrewCard } from "@/lib/graph"

const FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"

/** One shared tick for every spinner; still when nothing runs or the viewer prefers less motion. */
function useTick(on: boolean) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!on || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return
    const t = setInterval(() => setN((x) => x + 1), 90)
    return () => clearInterval(t)
  }, [on])
  return n
}

const BORDER: Record<string, string> = {
  running: "ring-running shadow-[inset_0_0_0_1px] shadow-running/20",
  "needs-you": "ring-needs-you",
  failed: "ring-failed",
}

const CHIP = {
  sendback: "bg-failed/15 text-failed",
  consult: "bg-consult/15 text-consult",
}

function Glyph({ status, tick }: { status: CrewCard["status"]; tick: number }) {
  if (status === "running") return <span className="text-running">{FRAMES[tick % FRAMES.length]}</span>
  if (status === "needs-you") return <span className="text-needs-you">●</span>
  if (status === "failed") return <span className="text-failed">✕</span>
  return <span className="text-muted-foreground">○</span>
}

function CrewCardView({ runId, card, tick }: { runId: string; card: CrewCard; tick: number }) {
  const { node, status, rounds, line, chip, stage } = card
  return (
    <a
      href={toHash({ view: "agent", id: runId, stage })}
      className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`${node.label}: ${status === "needs-you" ? "needs you" : status}${rounds > 1 ? `, round ${rounds}` : ""}. Open its console.`}
    >
      <Card size="sm" className={cn("gap-0.5 rounded-lg px-2.5 py-1.5 font-mono text-xs transition-colors hover:bg-muted/40", BORDER[status])}>
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <Glyph status={status} tick={tick} />
            <b className={cn("truncate font-bold", status === "idle" && "font-normal")}>{node.label}</b>
          </span>
          <span className="text-muted-foreground">{rounds > 1 ? `r${rounds}` : ""}</span>
        </div>
        <div className="truncate text-muted-foreground" title={line}>
          {line}
        </div>
        {chip && (
          <div>
            <span className={cn("rounded px-1.5 text-[11px]", CHIP[chip.kind])}>{chip.text}</span>
          </div>
        )}
      </Card>
    </a>
  )
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="font-mono text-[11px] tracking-widest text-muted-foreground">{label}</h3>
      {children}
    </section>
  )
}

/** The crew as cards: needs-you pinned on top, then running, then idle; done and skipped fold into one line. */
export function CrewCards({ runId, cards, footer }: { runId: string; cards: CrewCard[]; footer?: string }) {
  const needs = cards.filter((c) => c.status === "needs-you")
  const running = cards.filter((c) => c.status === "running")
  const idle = cards.filter((c) => c.status === "idle" || c.status === "failed")
  const done = cards.filter((c) => c.status === "done" || c.status === "skipped")
  const tick = useTick(running.length > 0)
  const grid = (cs: CrewCard[]) => (
    <div className="grid grid-cols-2 gap-1.5">
      {cs.map((c) => (
        <CrewCardView key={c.node.id} runId={runId} card={c} tick={tick} />
      ))}
    </div>
  )

  if (!cards.length) return <p className="font-mono text-xs text-muted-foreground">No crew yet.</p>
  return (
    <div className="flex flex-col gap-3" aria-label="Crew">
      {needs.length > 0 && <Section label={`NEEDS YOU · ${needs.length}`}>{grid(needs)}</Section>}
      {running.length > 0 && <Section label={`RUNNING · ${running.length}`}>{grid(running)}</Section>}
      {idle.length > 0 && <Section label="IDLE">{grid(idle)}</Section>}
      {done.length > 0 && (
        <Section label="DONE">
          <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground">
            {done.map((c) => (
              <a
                key={c.node.id}
                href={toHash({ view: "agent", id: runId, stage: c.stage })}
                className="rounded outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                {c.status === "done" ? <span className="text-running">✓</span> : "–"} {c.node.label}
                {c.status === "skipped" ? " (skipped)" : ""}
              </a>
            ))}
          </div>
        </Section>
      )}
      {footer && <p className="border-t pt-1.5 font-mono text-[11px] text-muted-foreground">{footer}</p>}
    </div>
  )
}
