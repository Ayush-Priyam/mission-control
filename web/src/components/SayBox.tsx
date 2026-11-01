import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { postAction } from "@/lib/api"

/** "@backend use 400" → { stage: "backend", text: "use 400" }; otherwise the default stage. */
export function parseSay(raw: string, fallback: string) {
  const m = raw.trim().match(/^@([\w.-]+)\s+([\s\S]+)$/)
  return m ? { stage: m[1], text: m[2].trim() } : { stage: fallback, text: raw.trim() }
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
    const m = parseSay(text, stage)
    if (!m.text || !m.stage) return
    setBusy(true)
    setNote(null)
    try {
      await postAction(runId, "say", m)
      set("")
      setNote({ ok: true, text: `Sent to ${m.stage}.` })
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
          onChange={(e) => set(e.target.value)}
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
