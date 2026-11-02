import { useState } from "react"
import { qaRows } from "@/lib/extras"
import { cn } from "@/lib/utils"

const TONE: Record<string, string> = { pass: "text-running", fail: "text-failed" }

/** The QA report card: the run's latest `qa` event as a score and a table. */
export default function Qa({ events }: { events: Record<string, any>[] }) {
  const rows = qaRows(events)
  const [open, setOpen] = useState<Set<number>>(() => new Set())
  if (!rows) return <p className="py-10 text-center font-mono text-xs text-muted-foreground">QA has not reported yet.</p>
  const n = (s: string) => rows.filter((r) => r.status === s).length
  const score: [string, number, string][] = [["pass", n("pass"), "text-running"], ["fail", n("fail"), "text-failed"], ["not verified", rows.length - n("pass") - n("fail"), "text-foreground"]]
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-6" aria-label="QA score">
        {score.map(([k, v, c]) => (
          <div key={k} className="flex flex-col"><b className={cn("font-mono text-2xl", c)}>{v}</b><span className="font-mono text-[11px] text-muted-foreground">{k}</span></div>
        ))}
      </div>
      <table className="w-full border-collapse text-xs">
        <thead><tr className="text-left font-mono text-[11px] text-muted-foreground"><th className="border-b py-1 pr-3">id</th><th className="border-b py-1 pr-3">state</th><th className="border-b py-1">evidence</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="border-b py-1.5 pr-3 align-top font-mono">{r.id}</td>
              <td className={cn("border-b py-1.5 pr-3 align-top font-mono", TONE[r.status] ?? "text-muted-foreground")}>{r.status}</td>
              <td className="border-b py-1.5 align-top">
                <button type="button" aria-expanded={open.has(i)} className={cn("text-left text-muted-foreground", !open.has(i) && "line-clamp-2")}
                  onClick={() => setOpen((s) => { const t = new Set(s); t.has(i) ? t.delete(i) : t.add(i); return t })}>{r.evidence}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
