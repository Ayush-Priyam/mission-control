import { useState } from "react"
import { useExtra } from "@/lib/api"
import { normaliseTasks, type Task } from "@/lib/extras"
import type { CrewCard } from "@/lib/graph"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

type Col = "todo" | "doing" | "done"
const HEAD: Record<Col, string> = { todo: "To do", doing: "Doing", done: "Done" }

/** A task is done when it is ticked or its lane finished; doing while its lane works or is stopped. */
function columnOf(t: Task, cards: CrewCard[]): Col {
  const card = t.lane ? cards.find((c) => c.node.id === t.lane || c.node.stages.includes(t.lane!)) : undefined
  if (t.done || card?.status === "done") return "done"
  return card?.status === "running" || card?.status === "needs-you" || card?.status === "failed" ? "doing" : "todo"
}

function TaskCard({ t, col }: { t: Task; col: Col }) {
  const [open, setOpen] = useState(false)
  return (
    <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
      className={cn("flex flex-col gap-1 rounded-lg border bg-card p-2.5 text-left text-xs transition-colors hover:bg-muted/40", col === "doing" && "border-consult/60")}>
      {(t.id || t.lane) && (
        <span className="flex items-center justify-between gap-2 font-mono text-[11px] text-muted-foreground">
          <b className="text-foreground">{t.id}</b>
          {t.lane && <span>{t.lane}</span>}
        </span>
      )}
      <span className={cn("leading-snug", !open && "line-clamp-3")}>{t.text.replace(/`/g, "")}</span>
    </button>
  )
}

/** The Board tab: the run's tasks in to do / doing / done columns. */
export default function Board({ runId, cards, refresh = 0 }: { runId: string; cards: CrewCard[]; refresh?: number }) {
  const r = useExtra<unknown>("tasks", runId, undefined, refresh)
  if (r.loading && !r.data) return <Skeleton className="h-48 w-full" />
  if (!r.data) return <p className="font-mono text-xs text-failed">Tasks not available ({r.error ?? "none"}).</p>
  const tasks = normaliseTasks(r.data)
  const cols: Record<Col, Task[]> = { todo: [], doing: [], done: [] }
  for (const t of tasks) cols[columnOf(t, cards)].push(t)
  if (!tasks.length) return <p className="py-10 text-center font-mono text-xs text-muted-foreground">No tasks yet.</p>
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {(Object.keys(cols) as Col[]).map((c) => (
        <section key={c} aria-label={HEAD[c]} className="flex min-w-0 flex-col gap-2 rounded-xl bg-muted/30 p-2">
          <h3 className="flex justify-between px-1 font-mono text-[11px] tracking-widest text-muted-foreground uppercase"><span>{HEAD[c]}</span><span>{cols[c].length}</span></h3>
          {cols[c].map((t, i) => <TaskCard key={`${t.id ?? ""}:${i}`} t={t} col={c} />)}
          {!cols[c].length && <p className="py-4 text-center font-mono text-[11px] text-muted-foreground">none</p>}
        </section>
      ))}
    </div>
  )
}
