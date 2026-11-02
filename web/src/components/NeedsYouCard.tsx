import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { parseSay } from "@/components/SayBox"
import { actionNote, postItemAction, type ActionNote as Note } from "@/lib/api"
import { ago } from "@/lib/format"
import { short } from "@/lib/events"
import { cn } from "@/lib/utils"

export type Ask = {
  /** true: an owner stop (needs you). false: stopped some other way (budget, failure rule…): grey, no buttons. */
  waiting: boolean
  lane?: string
  rule?: string
  detail?: string
  ts?: string
}

/**
 * The right rail's top card. Waiting: what for, and the source's declared actions (sign / send back / say).
 * Stopped by any other rule: a grey "stopped" card, never "failed".
 */
export function NeedsYouCard({ source, id, ask, actions, now, onActed }: { source: string; id: string; ask: Ask; actions: string[]; now: number; onActed?: () => void }) {
  const canSign = ask.waiting && actions.includes("sign")
  const canSay = ask.waiting && actions.includes("say")
  const [mode, setMode] = useState<"idle" | "back">("idle")
  const [notes, setNotes] = useState("")
  const [say, setSay] = useState("")
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<Note | null>(null)
  const lane = ask.lane ?? ""

  const run = async (name: string, body: object, done: string, after?: () => void) => {
    setBusy(true)
    setNote(null)
    try {
      const r = await postItemAction(source, id, name, body)
      const n = actionNote(done, r)
      setNote(n)
      if (n.ok) after?.()
      onActed?.()
    } catch (e: any) {
      setNote({ ok: false, text: String(e?.message ?? e) })
    } finally {
      setBusy(false)
    }
  }

  const sendSay = () => {
    const m = parseSay(say, lane)
    if ("error" in m) return setNote({ ok: false, text: m.error })
    void run("say", m, `Sent to ${m.stage}`, () => setSay(""))
  }

  return (
    <section
      aria-label={ask.waiting ? "Needs you" : "Stopped"}
      className={cn("flex flex-col gap-3 rounded-xl border p-4", ask.waiting ? "border-needs-you/70 bg-needs-you/5" : "border-stopped/40 border-dashed bg-card")}
    >
      <div className={cn("font-mono text-[11px] font-bold tracking-wider uppercase", ask.waiting ? "text-needs-you" : "text-stopped")}>
        {ask.waiting ? "Needs you" : `Stopped${ask.rule ? ` · ${ask.rule}` : ""}`}
        {lane ? <span className="font-normal normal-case"> · {lane}</span> : null}
      </div>
      <p className="text-[15px] leading-snug font-semibold">{short(ask.detail || (ask.waiting ? `${lane || "The run"} is waiting on you` : `${lane || "The run"} stopped`), 220)}</p>
      <p className="font-mono text-[11px] text-faint">
        {ask.ts ? `${ago(ask.ts, now)} ago · ` : ""}
        {ask.waiting ? (canSign || canSay ? "everything else waits until you answer" : "answer it where the agent runs") : "nothing runs until it is resumed"}
      </p>
      {canSign && mode === "idle" && (
        <div className="flex flex-col gap-2">
          <Button disabled={busy} onClick={() => void run("sign", { notes: "" }, "Signed")} className="justify-start">
            Approve (sign)
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => setMode("back")} className="justify-start">
            Send back with notes
          </Button>
        </div>
      )}
      {canSign && mode === "back" && (
        <div className="flex flex-col gap-2">
          <Textarea autoFocus value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={`What should ${lane || "the stage"} change?`} aria-label="Send-back notes" className="font-mono text-xs" />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setMode("idle")}>
              Cancel
            </Button>
            <Button size="sm" disabled={busy || !notes.trim()} onClick={() => void run("sign", { notes: notes.trim() }, "Sent back with your notes", () => { setMode("idle"); setNotes("") })}>
              Send back
            </Button>
          </div>
        </div>
      )}
      {canSay && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            sendSay()
          }}
        >
          <Input value={say} onChange={(e) => setSay(e.target.value)} placeholder="or answer in your own words" aria-label="Answer" className="text-xs" disabled={busy} />
          <Button type="submit" size="sm" variant="outline" disabled={busy || !say.trim()}>
            Send
          </Button>
        </form>
      )}
      {note && (
        <p role="status" className={cn("font-mono text-[11px]", note.ok ? "text-running" : "text-failed")}>
          {note.text}
        </p>
      )}
    </section>
  )
}
