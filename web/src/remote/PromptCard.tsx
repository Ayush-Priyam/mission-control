import { useEffect, useId, useRef, useState } from "react"
import { Ban, Check, LoaderCircle, Terminal, WifiOff } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ago } from "@/lib/format"
import { OFFLINE_TEXT, reasonText, type AnswerResult, type Decision, type Entry } from "@/lib/remote"
import { cn } from "@/lib/utils"
import { OFFLINE_BANNER_ID } from "./OfflineBanner"

export type AnswerFn = (promptId: string, bind: string, decision: Decision) => Promise<AnswerResult>

type Phase =
  | { kind: "idle" }
  | { kind: "busy"; button: string }
  | { kind: "done"; text: string }
  | { kind: "refused"; reason: string }
  | { kind: "netfail" }

const harness = (source: string) => (source === "claude-code" ? "CLAUDE CODE" : source === "codex" ? "CODEX" : source.toUpperCase())
const asked = (since: string, now: number) => (ago(since, now) === "now" ? "asked just now" : `asked ${ago(since, now)} ago`)
const BIG = "h-13 min-w-12 flex-1 text-base active:scale-[.97] motion-reduce:active:scale-100"

function Spin({ children }: { children: string }) {
  return (
    <>
      <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
      {children}
    </>
  )
}

/** One Needs you entry: a permission card, an ask card, or a read-only card. */
export function PromptCard({ entry, now, online, answer, onAuth, flagged = false }: { entry: Entry; now: number; online: boolean; answer: AnswerFn; onAuth: (kind: "revoked" | "not-paired") => void; flagged?: boolean }) {
  const titleId = useId()
  const [phase, setPhase] = useState<Phase>({ kind: "idle" })
  const [picks, setPicks] = useState<Record<string, string>>({})
  const reasonRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (phase.kind === "refused") reasonRef.current?.focus()
  }, [phase])

  const busy = phase.kind === "busy"
  const locked = busy || !online
  const kind = entry.answerable ? (entry.kind ?? "permission") : "readonly"
  const label = `${entry.tool} ${entry.target}${entry.project ? ` in ${entry.project}` : ""}`
  const disabledProps = (on: boolean) => ({ disabled: on, "aria-disabled": on || undefined, "aria-describedby": !online ? OFFLINE_BANNER_ID : undefined })

  const send = async (button: string, decision: Decision, done: string) => {
    if (busy || !entry.promptId || !entry.bind) return
    setPhase({ kind: "busy", button })
    const r = await answer(entry.promptId, entry.bind, decision)
    if (r.kind === "ok") setPhase({ kind: "done", text: done })
    else if (r.kind === "refused") setPhase({ kind: "refused", reason: r.reason })
    else if (r.kind === "offline") setPhase({ kind: "netfail" })
    else onAuth(r.kind)
  }

  const questions = entry.questions ?? []
  const single = questions.length === 1
  const complete = questions.length > 0 && questions.every((q) => picks[q.question])
  const answers = () => ({ answers: Object.fromEntries(questions.map((q) => [q.question, picks[q.question]])) })
  const finished = phase.kind === "done" || phase.kind === "refused"

  return (
    <article
      aria-labelledby={titleId}
      aria-busy={busy || undefined}
      data-kind={kind}
      className={cn("flex flex-col gap-3 rounded-xl border p-4 text-base", kind === "readonly" || phase.kind === "refused" ? "border-border bg-card" : "border-needs-you/70 bg-needs-you/5")}
    >
      <div className="flex items-center gap-2 font-mono text-xs font-bold tracking-wider text-needs-you uppercase">
        <span>
          {harness(entry.source)} · {kind === "ask" ? "QUESTION" : "PERMISSION"}
        </span>
        {flagged && <Badge variant="outline">new prompt</Badge>}
        <span className="ml-auto font-normal tracking-normal text-faint normal-case">{asked(entry.since, now)}</span>
      </div>
      <h2 id={titleId} className="leading-snug font-semibold">
        {entry.title}
      </h2>
      {entry.project && <p className="font-mono text-xs text-muted-foreground">{entry.project}</p>}

      {kind !== "ask" && (
        <p className="flex min-w-0 flex-col gap-1.5 rounded-lg border bg-background p-3 text-sm">
          <span className="font-mono font-semibold text-needs-you">{entry.tool}</span>
          <code className="font-mono break-words text-muted-foreground">{entry.target}</code>
        </p>
      )}

      {phase.kind === "done" && (
        <p role="status" className="flex items-center gap-2 font-semibold text-running">
          <Check className="size-4" aria-hidden />
          {phase.text}
        </p>
      )}
      {phase.kind === "refused" && (
        <p ref={reasonRef} tabIndex={-1} role="status" className="flex items-center gap-2 font-semibold text-failed outline-none">
          <Ban className="size-4" aria-hidden />
          {reasonText(phase.reason)}
        </p>
      )}
      {phase.kind === "netfail" && (
        <p role="status" className="flex items-center gap-2 text-sm font-semibold text-failed">
          <WifiOff className="size-4" aria-hidden />
          {OFFLINE_TEXT}
        </p>
      )}

      {kind === "readonly" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Terminal className="size-4" aria-hidden />
          answer where the agent runs
        </p>
      )}

      {kind === "permission" && !finished && (
        <div className="flex gap-3">
          <Button variant="destructive" aria-label={`Deny ${label}`} className={cn(BIG, "border border-destructive/40")} onClick={() => send("deny", "deny", "Denied")} {...disabledProps(locked)}>
            {phase.kind === "busy" && phase.button === "deny" ? <Spin>Denying…</Spin> : "Deny"}
          </Button>
          <Button aria-label={`Allow ${label}`} className={BIG} onClick={() => send("allow", "allow", "Allowed")} {...disabledProps(locked)}>
            {phase.kind === "busy" && phase.button === "allow" ? <Spin>Allowing…</Spin> : "Allow"}
          </Button>
        </div>
      )}

      {kind === "ask" && !finished && (
        <div className="flex flex-col gap-4">
          {questions.map((q, qi) => (
            <div key={q.question} className="flex flex-col gap-2">
              <p className="font-mono text-xs tracking-wider text-faint uppercase">{q.header}</p>
              <p id={`${titleId}-q${qi}`} className="font-semibold">
                {q.question}
              </p>
              <div role={single ? "group" : "radiogroup"} aria-labelledby={`${titleId}-q${qi}`} className="flex flex-col gap-3">
                {q.options.map((o) => {
                  const on = picks[q.question] === o.label
                  return (
                    <Button
                      key={o.label}
                      variant="outline"
                      role={single ? undefined : "radio"}
                      aria-checked={single ? undefined : on}
                      className={cn("h-15 flex-col items-start gap-0 text-left text-base whitespace-normal active:scale-[.97] motion-reduce:active:scale-100", on && "border-needs-you bg-needs-you/10")}
                      onClick={() => (single ? send(o.label, { answers: { [q.question]: o.label } }, "Answered") : setPicks((p) => ({ ...p, [q.question]: o.label })))}
                      {...disabledProps(locked)}
                    >
                      {phase.kind === "busy" && phase.button === o.label ? <Spin>Sending…</Spin> : <span className="font-semibold">{o.label}</span>}
                      {o.description && <span className="text-xs font-normal text-muted-foreground">{o.description}</span>}
                    </Button>
                  )
                })}
              </div>
            </div>
          ))}
          {!single && (
            <Button className={BIG} onClick={() => send("send", answers(), "Answered")} {...disabledProps(locked || !complete)}>
              {phase.kind === "busy" ? <Spin>Sending…</Spin> : "Send answers"}
            </Button>
          )}
        </div>
      )}
    </article>
  )
}
