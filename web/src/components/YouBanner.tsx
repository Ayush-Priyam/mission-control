import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { SayBox } from "@/components/SayBox"
import { postAction } from "@/lib/api"
import { hhmm, short } from "@/lib/events"
import type { Stop } from "@/lib/graph"

/** The run's current stop. An owner stop waits on you: what for, and what you may do about it (only
 * the actions the adapter declares). Any other stop is shown as Stopped (<rule>), with no buttons. */
export function YouBanner({ runId, stop, actions, onActed }: { runId: string; stop: Stop; actions: string[]; onActed?: () => void }) {
  const waiting = stop.waiting
  const canSign = waiting && actions.includes("sign")
  const canSay = waiting && actions.includes("say")
  const [sending, setSending] = useState(false)
  const [notes, setNotes] = useState("")
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const stage = stop.stage ?? ""

  const sign = async (withNotes: string) => {
    setBusy(true)
    setNote(null)
    try {
      await postAction(runId, "sign", { notes: withNotes })
      setNote({ ok: true, text: withNotes ? "Sent back with your notes." : "Signed." })
      setSending(false)
      setNotes("")
      onActed?.()
    } catch (e: any) {
      setNote({ ok: false, text: String(e?.message ?? e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-label={waiting ? "Needs you" : "Stopped"}
      className={waiting ? "flex flex-col gap-3 rounded-xl border border-needs-you/70 bg-needs-you/8 p-3" : "flex flex-col gap-3 rounded-xl border border-failed/60 bg-failed/8 p-3"}
    >
      <div className="flex flex-wrap items-start gap-3">
        <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-widest ${waiting ? "bg-needs-you/20 text-needs-you" : "bg-failed/20 text-failed"}`}>
          {waiting ? "NEEDS YOU" : `STOPPED${stop.rule ? ` (${stop.rule.toUpperCase()})` : ""}`}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <b className="text-sm font-semibold">{short(stop.detail || (waiting ? `${stage || "the run"} is waiting on you` : `${stage || "the run"} stopped`), 140)}</b>
          <span className="font-mono text-[11px] text-muted-foreground">
            {waiting ? "Needs you" : `Stopped${stop.rule ? ` (${stop.rule})` : ""}`} · {stage || "run"}
            {stop.ts ? ` at ${hhmm(stop.ts)}` : ""}
            {waiting ? " · everything else waits until you answer" : ""}
          </span>
        </div>
        {canSign && !sending && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setSending(true)}>
              Send back
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void sign("")}>
              Sign
            </Button>
          </div>
        )}
      </div>
      {canSign && sending && (
        <div className="flex flex-col gap-2">
          <Textarea
            autoFocus
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={`What should ${stage || "the stage"} change?`}
            aria-label="Send-back notes"
            className="font-mono text-xs"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSending(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={busy || !notes.trim()} onClick={() => void sign(notes.trim())}>
              Send back with notes
            </Button>
          </div>
        </div>
      )}
      {canSay && <SayBox runId={runId} stage={stage} placeholder={`Answer ${stage || "the run"} in your own words`} onSent={onActed} />}
      {note && (
        <p role="status" className={`font-mono text-[11px] ${note.ok ? "text-running" : "text-failed"}`}>
          {note.text}
        </p>
      )}
    </section>
  )
}
