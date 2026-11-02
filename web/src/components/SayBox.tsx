import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { actionNote, postAction } from "@/lib/api"

export type Say = { stage: string; text: string } | { error: string }

/** "@backend use 400" → { stage: "backend", text: "use 400" }; plain text goes to the fallback stage.
 * No stage to send to, or an @stage with nothing after it, is an error to show, never a send. */
export function parseSay(raw: string, fallback: string): Say {
  const t = raw.trim()
  const m = t.match(/^@([\w.-]+)(?:\s+([\s\S]*))?$/)
  if (m) {
    const text = (m[2] ?? "").trim()
    return text ? { stage: m[1], text } : { error: `Write a message after @${m[1]}` }
  }
  return fallback ? { stage: fallback, text: t } : { error: "Start with @stage" }
}

/** The answer box: posts the `say` action. Render it only when capabilities.actions has "say". */
export function SayBox({
  runId,
  stage,
  value,
  onValue,
  onSent,
  placeholder,
}: {
  runId: string
  stage: string
  value?: string
  onValue?: (v: string) => void
  onSent?: (m: { stage: string; text: string }) => void
  placeholder?: string
}) {
  const [own, setOwn] = useState("")
  const text = value ?? own
  const set = onValue ?? setOwn
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)

  const send = async () => {
    if (!text.trim()) return
    const m = parseSay(text, stage)
    if ("error" in m) {
      setNote({ ok: false, text: m.error })
      return
    }
    setBusy(true)
    setNote(null)
    try {
      const n = actionNote(`Sent to ${m.stage}`, await postAction(runId, "say", m))
      set("")
      setNote(n)
      onSent?.(m)
    } catch (e: any) {
      setNote({ ok: false, text: String(e?.message ?? e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <span className="font-mono text-sm text-consult" aria-hidden>
          ›
        </span>
        <Input
          value={text}
          onChange={(e) => {
            set(e.target.value)
            if (note && !note.ok) setNote(null)
          }}
          placeholder={placeholder ?? `Answer ${stage || "the crew"}, or @stage …`}
          aria-label="Answer"
          className="font-mono text-xs"
          disabled={busy}
        />
        <Button type="submit" size="sm" disabled={busy || !text.trim()}>
          Send
        </Button>
      </form>
      {note && (
        <p role="status" className={`font-mono text-[11px] ${note.ok ? "text-running" : "text-failed"}`}>
          {note.text}
        </p>
      )}
    </div>
  )
}
